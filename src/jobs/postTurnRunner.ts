import { v4 as uuidv4 } from "uuid";
import { db } from "../db/client";
import { postTurnJobs, type PostTurnJobRow } from "../db/schema/jobs";
import { extractPostTurnSignals } from "../llm/extraction/extractPostTurnSignals";
import { writeInteractiveMemory } from "../memory/interactive/writeInteractiveMemory";
import { maybeCompactSessionSummary } from "../memory/session/compactSessionSummary";
import {
  persistSessionMemoryChunk,
  sessionMemoryChunkExists,
  writeRawTurnPairSessionChunkTraced,
} from "../memory/session/writeSessionMemoryChunk";
import type { SessionChunkTypePersisted } from "../memory/session/writeSessionMemoryChunk";
import type { MemoryNamespace } from "../memory/shared/memoryNamespace";
import {
  traceStage,
  traceStageWithIO,
} from "../observability/langsmithTracing";
import { env } from "../config/env";
import { collectPhase1StructMemPersistRows } from "../memory/structmem/structmemMapping";
import { writeStructMemTurn } from "../memory/structmem/writeStructMemTurn";
import { eq, sql } from "drizzle-orm";
import { BackgroundRunner } from "./backgroundRunner";
import {
  INITIAL_POST_TURN_STEP_STATUS,
  chatSessionFromSnapshot,
  isStepComplete,
  markStepCompleted,
  normalizeStepStatus,
  parsePostTurnJobPayload,
  type PostTurnJobPayloadV1,
  type PostTurnStepName,
  type PostTurnStepStatus,
} from "./postTurnJobPayload";
import {
  buildPostTurnWritePlan,
  type PostTurnWritePlanEnv,
} from "./postTurnPolicies";
import { maybeEnqueueStructMemConsolidation } from "../memory/structmem/structmemConsolidationRepo";
import { structmemConsolidationRunner } from "./structmemConsolidationRunner";

type PostTurnWritePlanTraceInput = {
  session: Parameters<typeof buildPostTurnWritePlan>[0];
  env: Parameters<typeof buildPostTurnWritePlan>[1];
  signals: Parameters<typeof buildPostTurnWritePlan>[2];
};

function unwrapPostTurnWritePlanTraceInput(
  inputs: Record<string, unknown>,
): PostTurnWritePlanTraceInput {
  if ("input" in inputs && inputs.input) {
    return inputs.input as PostTurnWritePlanTraceInput;
  }
  return inputs as unknown as PostTurnWritePlanTraceInput;
}

const tracedExtract = traceStage(
  "llm.extract_post_turn_signals",
  extractPostTurnSignals,
);

const tracedBuildPostTurnWritePlan = traceStageWithIO(
  "post_turn.write_plan",
  async (input: PostTurnWritePlanTraceInput) =>
    buildPostTurnWritePlan(input.session, input.env, input.signals),
  {
    tags: ["post_turn", "policy"],
    processInputs: (inputs) => {
      const input = unwrapPostTurnWritePlanTraceInput(inputs);
      return {
        sessionMode: input.session.mode,
        writebackPolicy: input.session.writebackPolicy,
        structMemEnabled: input.env.STRUCTMEM_ENABLED,
        structMemConsolidationEnabled:
          input.env.STRUCTMEM_CONSOLIDATION_ENABLED,
        nativeStructMemExtractor: input.env.STRUCTMEM_NATIVE_EXTRACTOR,
        suppressExtractorSessionChunks:
          input.env.STRUCTMEM_SUPPRESS_EXTRACTOR_SESSION_CHUNKS,
        memoryFactCount: input.signals.memoryFacts.length,
        nativeStructMemEntryCount: input.signals.structMemEntries.length,
        shouldWriteMemory: input.signals.shouldWriteMemory,
      };
    },
    processOutputs: (outputs) => outputs,
  },
);

function postTurnWritePlanEnv(): PostTurnWritePlanEnv {
  return {
    STRUCTMEM_ENABLED: env.STRUCTMEM_ENABLED,
    STRUCTMEM_CONSOLIDATION_ENABLED: env.STRUCTMEM_CONSOLIDATION_ENABLED,
    STRUCTMEM_SUPPRESS_EXTRACTOR_SESSION_CHUNKS:
      env.STRUCTMEM_SUPPRESS_EXTRACTOR_SESSION_CHUNKS,
    STRUCTMEM_NATIVE_EXTRACTOR: env.STRUCTMEM_NATIVE_EXTRACTOR,
  };
}

export function newPostTurnJobId(): string {
  return uuidv4();
}

function nextRunAfter(attempts: number): Date {
  const delayMs = Math.min(5 * 60_000, 1000 * 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + delayMs);
}

class PostTurnRunner extends BackgroundRunner {
  private readonly workerId = `post-turn-${process.pid}-${uuidv4()}`;

  constructor() {
    super("postTurnRunner", env.POST_TURN_JOB_POLL_INTERVAL_MS);
  }

  protected async runLoop(): Promise<void> {
    while (true) {
      const job = await this.claimNextJob();
      if (!job) return;
      await this.runClaimedJob(job);
    }
  }

  private async claimNextJob(): Promise<PostTurnJobRow | null> {
    const rows = await db.execute(sql`
      UPDATE post_turn_jobs
      SET
        status = 'running',
        attempts = attempts + 1,
        locked_at = NOW(),
        locked_by = ${this.workerId},
        updated_at = NOW(),
        last_error = NULL
      WHERE id = (
        SELECT id
        FROM post_turn_jobs
        WHERE
          (
            status IN ('pending', 'retry')
            AND run_after <= NOW()
          )
          OR (
            status = 'running'
            AND locked_at IS NOT NULL
            AND locked_at < NOW() - (${env.POST_TURN_JOB_LOCK_TTL_MS}::int * INTERVAL '1 millisecond')
          )
        ORDER BY run_after ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING
        id,
        session_id AS "sessionId",
        user_message_id AS "userMessageId",
        assistant_message_id AS "assistantMessageId",
        status,
        attempts,
        max_attempts AS "maxAttempts",
        run_after AS "runAfter",
        locked_at AS "lockedAt",
        locked_by AS "lockedBy",
        step_status AS "stepStatus",
        payload,
        last_error AS "lastError",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `);

    return (rows.rows[0] as unknown as PostTurnJobRow | undefined) ?? null;
  }

  private async persistJobProgress(input: {
    jobId: string;
    payload: PostTurnJobPayloadV1;
    stepStatus: PostTurnStepStatus;
  }): Promise<void> {
    await db
      .update(postTurnJobs)
      .set({
        payload: input.payload as unknown as Record<string, unknown>,
        stepStatus: input.stepStatus,
        updatedAt: new Date(),
      })
      .where(eq(postTurnJobs.id, input.jobId));
  }

  private async markCompleted(
    jobId: string,
    step: PostTurnStepName,
    payload: PostTurnJobPayloadV1,
    stepStatus: PostTurnStepStatus,
  ): Promise<PostTurnStepStatus> {
    const next = markStepCompleted(stepStatus, step);
    await this.persistJobProgress({ jobId, payload, stepStatus: next });
    return next;
  }

  private async completeJob(jobId: string): Promise<void> {
    await db
      .update(postTurnJobs)
      .set({
        status: "completed",
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(postTurnJobs.id, jobId));
  }

  private async failJob(job: PostTurnJobRow, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    const exhausted = job.attempts >= job.maxAttempts;
    await db
      .update(postTurnJobs)
      .set({
        status: exhausted ? "failed" : "retry",
        runAfter: exhausted ? job.runAfter : nextRunAfter(job.attempts),
        lockedAt: null,
        lockedBy: null,
        lastError: message.slice(0, 8000),
        updatedAt: new Date(),
      })
      .where(eq(postTurnJobs.id, job.id));
    console.error(`[postTurnRunner] job ${job.id} failed:`, err);
  }

  private async runClaimedJob(job: PostTurnJobRow): Promise<void> {
    try {
      let payload = parsePostTurnJobPayload(job.payload);
      let stepStatus = normalizeStepStatus(job.stepStatus);
      const session = chatSessionFromSnapshot(payload.session);
      const recentMemoriesStr = payload.recentMemorySummaries
        .slice(0, 3)
        .join("\n");

      if (!isStepComplete(stepStatus, "raw_chunk")) {
        await writeRawTurnPairSessionChunkTraced({
          session,
          userTurnIndex: payload.userTurnIndex,
          assistantTurnIndex: payload.assistantTurnIndex,
          userMessage: payload.userMessage,
          assistantReply: payload.assistantReply,
        });
        stepStatus = await this.markCompleted(
          job.id,
          "raw_chunk",
          payload,
          stepStatus,
        );
      }

      if (!isStepComplete(stepStatus, "extract_signals")) {
        const signals = await tracedExtract({
          userMessage: payload.userMessage,
          assistantReply: payload.assistantReply,
          sessionMode: session.mode,
          recentMemories: recentMemoriesStr,
          sessionState: JSON.stringify(payload.derivedState),
        });
        payload = { ...payload, signals };
        stepStatus = await this.markCompleted(
          job.id,
          "extract_signals",
          payload,
          stepStatus,
        );
      }

      const signals = payload.signals;
      if (!signals) {
        throw new Error("post-turn payload missing extracted signals");
      }

      const writePlan = await tracedBuildPostTurnWritePlan({
        session,
        env: postTurnWritePlanEnv(),
        signals: {
          memoryFacts: signals.memoryFacts,
          structMemEntries: signals.structMemEntries,
          shouldWriteMemory: payload.shouldWriteMemory,
        },
      });

      if (!isStepComplete(stepStatus, "structmem")) {
        if (writePlan.structMem.write) {
          const useNative = env.STRUCTMEM_NATIVE_EXTRACTOR;
          const rows = useNative
            ? signals.structMemEntries
            : collectPhase1StructMemPersistRows(signals.memoryFacts);
          if (rows.length > 0) {
            await writeStructMemTurn({
              session,
              latestTurnIndex: payload.assistantTurnIndex,
              userMessageId: payload.userMessageId,
              assistantMessageId: payload.assistantMessageId,
              rows,
              extractorBatchConfidence:
                signals.modelReportedConfidence.memoryFacts,
              mergeNativeStructMemSource: useNative,
            });
          }
        }
        stepStatus = await this.markCompleted(
          job.id,
          "structmem",
          payload,
          stepStatus,
        );
      }

      if (writePlan.structMemConsolidation.write) {
        const enqueueResult = await maybeEnqueueStructMemConsolidation({
          session,
        });
        if (enqueueResult.status === "enqueued") {
          structmemConsolidationRunner.wake();
        }
      }

      if (!isStepComplete(stepStatus, "session_chunks")) {
        if (writePlan.sessionChunks.write) {
          for (let i = 0; i < signals.memoryFacts.length; i++) {
            const candidate = signals.memoryFacts[i]!;
            if (candidate.memoryScope !== "current_session") continue;
            const chunkType = (candidate.sessionChunkType ??
              "scene_moment") as SessionChunkTypePersisted;
            const metadata = {
              source: "extractor",
              memoryType: candidate.memoryType,
              assistantMessageId: payload.assistantMessageId,
              candidateIndex: i,
            };
            const exists = await sessionMemoryChunkExists({
              sessionId: payload.sessionId,
              turnStart: payload.userTurnIndex,
              turnEnd: payload.assistantTurnIndex,
              chunkType,
              metadataContains: {
                assistantMessageId: payload.assistantMessageId,
                candidateIndex: i,
              },
            });
            if (exists) continue;
            await persistSessionMemoryChunk({
              sessionId: payload.sessionId,
              characterId: session.characterId,
              playerId: session.playerId,
              turnStart: payload.userTurnIndex,
              turnEnd: payload.assistantTurnIndex,
              chunkText: candidate.summary,
              chunkType,
              metadata,
              embedding: candidate.embedding,
            });
          }
        }
        stepStatus = await this.markCompleted(
          job.id,
          "session_chunks",
          payload,
          stepStatus,
        );
      }

      if (!isStepComplete(stepStatus, "durable_memory")) {
        if (writePlan.durableMemory.write) {
          for (const candidate of signals.memoryFacts) {
            if (candidate.memoryScope !== "cross_session") continue;
            await writeInteractiveMemory({
              candidate,
              characterId: session.characterId,
              playerId: session.playerId,
              sessionId: payload.sessionId,
              continuityScope: session.continuityScope,
              continuityFamily: session.continuityFamily as "main_world" | "au",
              memoryNamespace: session.memoryNamespace as MemoryNamespace,
            });
          }
        }
        stepStatus = await this.markCompleted(
          job.id,
          "durable_memory",
          payload,
          stepStatus,
        );
      }

      if (!isStepComplete(stepStatus, "summary_compact")) {
        await maybeCompactSessionSummary({
          session,
          latestTurnIndex: payload.assistantTurnIndex,
        });
        stepStatus = await this.markCompleted(
          job.id,
          "summary_compact",
          payload,
          stepStatus,
        );
      }

      await this.completeJob(job.id);
    } catch (err) {
      await this.failJob(job, err);
    }
  }
}

export const postTurnRunner = new PostTurnRunner();
export { INITIAL_POST_TURN_STEP_STATUS };

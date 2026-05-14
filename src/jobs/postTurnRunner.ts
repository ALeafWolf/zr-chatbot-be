import { v4 as uuidv4 } from "uuid";
import { db } from "../db/client";
import { postTurnJobs, type PostTurnJobRow } from "../db/schema/jobs";
import { extractPostTurnSignals } from "../llm/extractPostTurnSignals";
import { writeInteractiveMemory } from "../memory/writeInteractiveMemory";
import { maybeCompactSessionSummary } from "../memory/compactSessionSummary";
import {
  persistSessionMemoryChunk,
  sessionMemoryChunkExists,
  writeRawTurnPairSessionChunkTraced,
} from "../memory/writeSessionMemoryChunk";
import type { SessionChunkTypePersisted } from "../memory/writeSessionMemoryChunk";
import type { MemoryNamespace } from "../memory/memoryNamespace";
import { traceStage } from "../observability/langsmithTracing";
import { env } from "../config/env";
import { collectPhase1StructMemPersistRows } from "../memory/structmemMapping";
import { writeStructMemTurn } from "../memory/writeStructMemTurn";
import { eq, sql } from "drizzle-orm";
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
import { shouldSuppressExtractorSessionChunks } from "./postTurnSessionChunkPolicy";
import { maybeEnqueueStructMemConsolidation } from "../memory/structmemConsolidationRepo";
import { structmemConsolidationRunner } from "./structmemConsolidationRunner";

const tracedExtract = traceStage(
  "llm.extract_post_turn_signals",
  extractPostTurnSignals,
);

export function newPostTurnJobId(): string {
  return uuidv4();
}

function nextRunAfter(attempts: number): Date {
  const delayMs = Math.min(5 * 60_000, 1000 * 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + delayMs);
}

class PostTurnRunner {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private inFlight: Promise<void>[] = [];
  private readonly workerId = `post-turn-${process.pid}-${uuidv4()}`;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(
      () => this.wake(),
      env.POST_TURN_JOB_POLL_INTERVAL_MS,
    );
    this.timer.unref?.();
    this.wake();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  wake(): void {
    if (this.running) return;
    const task = this.runLoop()
      .catch((err) => {
        console.error("[postTurnRunner] run loop failed:", err);
      })
      .finally(() => {
        this.running = false;
        this.inFlight = this.inFlight.filter((p) => p !== task);
      });
    this.running = true;
    this.inFlight.push(task);
  }

  async drain(): Promise<void> {
    this.stop();
    await Promise.allSettled(this.inFlight);
  }

  private async runLoop(): Promise<void> {
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

      if (!isStepComplete(stepStatus, "structmem")) {
        if (env.STRUCTMEM_ENABLED && session.mode !== "sandbox") {
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

      if (
        env.STRUCTMEM_ENABLED &&
        env.STRUCTMEM_CONSOLIDATION_ENABLED &&
        session.mode !== "sandbox"
      ) {
        const enqueueResult = await maybeEnqueueStructMemConsolidation({
          session,
        });
        if (enqueueResult.status === "enqueued") {
          structmemConsolidationRunner.wake();
        }
      }

      if (!isStepComplete(stepStatus, "session_chunks")) {
        if (session.mode !== "sandbox") {
          const suppressChunks = shouldSuppressExtractorSessionChunks({
            structMemEnabled: env.STRUCTMEM_ENABLED,
            suppressExtractorSessionChunks:
              env.STRUCTMEM_SUPPRESS_EXTRACTOR_SESSION_CHUNKS,
            nativeStructMemExtractor: env.STRUCTMEM_NATIVE_EXTRACTOR,
          });
          for (let i = 0; i < signals.memoryFacts.length; i++) {
            const candidate = signals.memoryFacts[i]!;
            if (candidate.memoryScope !== "current_session") continue;
            if (suppressChunks) continue;
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
        if (payload.shouldWriteMemory) {
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

import { v4 as uuidv4 } from "uuid";
import { db } from "../db/client";
import { postTurnJobs, type PostTurnJobRow } from "../db/schema/jobs";
import { extractPostTurnSignals } from "../llm/extraction/extractPostTurnSignals";
import {
  traceLLMStage,
  withTraceContext,
} from "../observability/langsmithTracing";
import { env } from "../config/env";
import { models } from "../config/models";
import { buildTraceBaseMetadata } from "../observability/traceMetadata";
import { eq, sql } from "drizzle-orm";
import { BackgroundRunner } from "./backgroundRunner";
import {
  INITIAL_POST_TURN_STEP_STATUS,
  chatSessionFromSnapshot,
  markStepCompleted,
  normalizeStepStatus,
  parsePostTurnJobPayload,
  type PostTurnJobPayloadV1,
  type PostTurnStepName,
  type PostTurnStepStatus,
} from "./postTurnJobPayload";
import { structmemConsolidationRunner } from "./structmemConsolidationRunner";
import {
  getAgentEvalCapture,
  recordMemoryWriteSnapshot,
} from "../eval/evalSnapshots";
import { defaultPostTurnMemoryGraphDeps, createPostTurnMemoryGraph } from "../orchestration/graphs/postTurnMemoryGraph";
import type { PostTurnMemoryGraphDeps } from "../orchestration/graphs/postTurnMemoryGraph";
import { createInitialPostTurnRuntimeState } from "../orchestration/graphState/postTurnGraphState";

const tracedExtract = traceLLMStage(
  "llm.extract_post_turn_signals",
  extractPostTurnSignals,
  {
    subsystem: "llm",
    turn: "background",
    llm: { binding: models.extractor, modelRole: "extractor" },
  },
);

// tracedBuildPostTurnWritePlan was removed in TG2 (not needed by graph — the
// underlying sync buildPostTurnWritePlan is used instead). If TG3 re-evaluates
// and wants the post_turn.write_plan child span back, restore it here:
//   https://github.com/langchain-ai/langgraphjs/issues/NNN
// For now the graph's compiled orchestration.post_turn_memory_graph span
// provides parent-level trace visibility.

export function newPostTurnJobId(): string {
  return uuidv4();
}

function nextRunAfter(attempts: number): Date {
  const delayMs = Math.min(5 * 60_000, 1000 * 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + delayMs);
}

export class PostTurnRunner extends BackgroundRunner {
  private readonly workerId = `post-turn-${process.pid}-${uuidv4()}`;

  constructor() {
    super("postTurnRunner", env.POST_TURN_JOB_POLL_INTERVAL_MS);
  }

  /**
   * Eval isolation: when a turn runs inside an eval capture, runAgentEval drives
   * the post-turn job synchronously via runJobByIdForEval → runSyncForEval, inside
   * the eval AsyncLocalStorage scope. The background loop must NOT claim that job —
   * running it from the loop executes the engine outside the capture (so the
   * emotional-axis update snapshot is lost) and races the sync run (double-write).
   *
   * `runCharacterTurn` calls `wakePostTurnRunner()` while still inside
   * `withAgentEvalCapture`, so this gate reliably keeps the loop off eval jobs.
   * In production there is no eval capture, so `wake()` behaves normally.
   */
  override wake(): void {
    if (getAgentEvalCapture()) return;
    super.wake();
  }

  protected async runLoop(): Promise<void> {
    while (true) {
      const job = await this.claimNextJob();
      if (!job) return;
      await this.runClaimedJob(job);
    }
  }

  /** Override in tests to load and claim an eval job without touching the DB.
   *  Returns the claimed job or null if the job is not found or already completed. */
  protected async loadAndClaimEvalJob(
    jobId: string,
  ): Promise<{ job: PostTurnJobRow } | { missing: boolean; completed: boolean }> {
    const existingRows = await db
      .select()
      .from(postTurnJobs)
      .where(eq(postTurnJobs.id, jobId))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) return { missing: true, completed: false };
    if (existing.status === "completed") return { missing: false, completed: true };

    const rows = await db
      .update(postTurnJobs)
      .set({
        status: "running",
        attempts: sql`${postTurnJobs.attempts} + 1`,
        lockedAt: new Date(),
        lockedBy: this.workerId,
        updatedAt: new Date(),
        lastError: null,
      })
      .where(eq(postTurnJobs.id, jobId))
      .returning();
    return { job: rows[0]! };
  }

  /**
   * Run a post-turn job synchronously inside the eval capture context,
   * bypassing the background queue/claim entirely.
   *
   * This is called from runAgentEval after runCharacterTurn enqueues the job.
   * It atomically claims the job (status='running'), reads the payload,
   * runs the post-turn memory graph, and marks the job completed — all within
   * the caller's AsyncLocalStorage scope.
   *
   * By claiming the job first, the background loop cannot pick it up
   * (it only claims 'pending'/'retry' jobs or 'running' with expired locks).
   *
   * Protected so unit tests can override without DB access.
   */
  protected async runSyncForEval(jobId: string): Promise<void> {
    // Atomically claim the job so the background loop cannot take it
    const claimRows = await db
      .update(postTurnJobs)
      .set({
        status: "running",
        lockedAt: new Date(),
        lockedBy: "eval-sync",
        updatedAt: new Date(),
      })
      .where(eq(postTurnJobs.id, jobId))
      .returning();

    if (claimRows.length === 0) {
      recordMemoryWriteSnapshot({
        status: "failed",
        error: `post_turn_job_not_found:${jobId}`,
      });
      throw new Error(`post_turn_job_not_found:${jobId}`);
    }
    const job = claimRows[0]!;
    recordMemoryWriteSnapshot({
      postTurnJobId: job.id,
      status: "not_run",
    });

    try {
      const payload = parsePostTurnJobPayload(job.payload);
      const stepStatus = normalizeStepStatus(job.stepStatus);
      const session = chatSessionFromSnapshot(payload.session);
      const recentMemoriesStr = payload.recentMemorySummaries
        .slice(0, 3)
        .join("\n");

      const deps = defaultPostTurnMemoryGraphDeps({
        persistStepComplete: this.persistStepComplete.bind(this),
        completeJobFn: this.completeJob.bind(this),
        wakeConsolidationFn: () => structmemConsolidationRunner.wake(),
        extractFn: tracedExtract,
      });

      const initialState = createInitialPostTurnRuntimeState(
        { jobId: job.id, attempts: job.attempts, payload, stepStatus },
        session,
        recentMemoriesStr,
      );

      const graph = this.createGraph(deps);
      const state = await graph.invoke(initialState, {
        tags: ["turn:background", "subsystem:post_turn", "graph:postTurnMemoryGraph", "eval:sync"],
        metadata: {
          postTurnJobId: job.id,
          sessionId: payload.sessionId,
          evalMode: true,
        },
      });

      if (state.errors && state.errors.length > 0) {
        const stages = state.errors.map((e: { stage: string }) => e.stage).join(", ");
        const messages = state.errors.map((e: { stage: string; message: string }) => `${e.stage}: ${e.message}`).join("; ");
        const retryReason = state.lastRetryReason ? ` (retry reason: ${state.lastRetryReason})` : "";
        throw new Error(`Post-turn memory graph failed [${stages}]: ${messages}${retryReason}`);
      }

      await this.completeJob(job.id);
      recordMemoryWriteSnapshot({ status: "completed" });
    } catch (err) {
      await this.failJob(job, err);
      recordMemoryWriteSnapshot({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async runJobByIdForEval(jobId: string): Promise<void> {
    try {
      await this.runSyncForEval(jobId);
    } catch (err) {
      // runSyncForEval already records failure snapshot for DB-not-found.
      // For other errors (test overrides, graph failures), ensure the snapshot
      // reflects the failure state.
      const capture = getAgentEvalCapture();
      if (capture && capture.memoryWrite.status !== "failed") {
        recordMemoryWriteSnapshot({
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
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

  /** Override in tests to inject a fake graph. */
  protected createGraph(deps: PostTurnMemoryGraphDeps) {
    return createPostTurnMemoryGraph(deps);
  }

  async persistStepComplete(
    jobId: string,
    step: PostTurnStepName,
    payload: PostTurnJobPayloadV1,
    stepStatus: PostTurnStepStatus,
  ): Promise<PostTurnStepStatus> {
    const next = markStepCompleted(stepStatus, step);
    await this.persistJobProgress({ jobId, payload, stepStatus: next });
    return next;
  }

  async completeJob(jobId: string): Promise<void> {
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

  protected async failJob(job: PostTurnJobRow, err: unknown): Promise<void> {
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

  protected async runClaimedJob(job: PostTurnJobRow): Promise<boolean> {
    try {
      recordMemoryWriteSnapshot({
        postTurnJobId: job.id,
        status: "not_run",
      });
      const payload = parsePostTurnJobPayload(job.payload);
      const stepStatus = normalizeStepStatus(job.stepStatus);
      const session = chatSessionFromSnapshot(payload.session);
      const recentMemoriesStr = payload.recentMemorySummaries
        .slice(0, 3)
        .join("\n");

      await withTraceContext(
        {
          baseMetadata: buildTraceBaseMetadata({
            session,
            turnIndex: payload.assistantTurnIndex,
            extra: {
              postTurnJobId: job.id,
              userMessageId: payload.userMessageId,
              assistantMessageId: payload.assistantMessageId,
              userTurnIndex: payload.userTurnIndex,
              assistantTurnIndex: payload.assistantTurnIndex,
            },
          }),
          characterId: session.characterId,
          turn: "background",
        },
        async () => {
          const deps = defaultPostTurnMemoryGraphDeps({
            persistStepComplete: this.persistStepComplete.bind(this),
            completeJobFn: this.completeJob.bind(this),
            wakeConsolidationFn: () => structmemConsolidationRunner.wake(),
            extractFn: tracedExtract,
            // tracedBuildPostTurnWritePlan has a wrapped input shape ({session, env, signals})
            // so we use the underlying sync buildPostTurnWritePlan directly.
            // The graph-level compile span provides the parent trace visibility.
          });

          const initialState = createInitialPostTurnRuntimeState(
            { jobId: job.id, attempts: job.attempts, payload, stepStatus },
            session,
            recentMemoriesStr,
          );

          const graph = this.createGraph(deps);
          const state = await graph.invoke(initialState, {
            tags: ["turn:background", "subsystem:post_turn", "graph:postTurnMemoryGraph"],
            metadata: {
              postTurnJobId: job.id,
              sessionId: payload.sessionId,
              userMessageId: payload.userMessageId,
              assistantMessageId: payload.assistantMessageId,
              userTurnIndex: payload.userTurnIndex,
              assistantTurnIndex: payload.assistantTurnIndex,
              attempts: job.attempts,
            },
          });

          if (state.errors && state.errors.length > 0) {
            const stages = state.errors.map((e: { stage: string }) => e.stage).join(", ");
            const messages = state.errors.map((e: { stage: string; message: string }) => `${e.stage}: ${e.message}`).join("; ");
            const retryReason = state.lastRetryReason ? ` (retry reason: ${state.lastRetryReason})` : "";
            throw new Error(`Post-turn memory graph failed [${stages}]: ${messages}${retryReason}`);
          }

          // Graph's markJobCompleteNode already called completeJobFn +
          // recordSnapshotFn({ status: "completed" }).
          // Preserve the runner-level completion snapshot for symmetry.
          recordMemoryWriteSnapshot({ status: "completed" });
        },
      );
      return true;
    } catch (err) {
      await this.failJob(job, err);
      recordMemoryWriteSnapshot({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }
}

export const postTurnRunner = new PostTurnRunner();
export { INITIAL_POST_TURN_STEP_STATUS };

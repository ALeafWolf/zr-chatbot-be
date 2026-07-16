import { v4 as uuidv4 } from "uuid";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import type { StructMemConsolidationJob } from "../db/schema/structmem";
import { env } from "../config/env";
import { BackgroundRunner } from "./backgroundRunner";
import {
  failStructMemConsolidationJob,
} from "../memory/structmem/structmemConsolidationRepo";
import { withTraceContext } from "../observability/langsmithTracing";
import {
  buildTraceBaseMetadata,
  hashPlayerId,
} from "../observability/traceMetadata";
import { getStructMemConsolidationGraph } from "../orchestration/graphs/structMemConsolidationGraph";
import { getAgentEvalCapture } from "../eval/evalSnapshots";

async function claimStructMemConsolidationJobImpl(
  workerId: string,
): Promise<StructMemConsolidationJob | null> {
  if (!env.STRUCTMEM_ENABLED || !env.STRUCTMEM_CONSOLIDATION_ENABLED) {
    return null;
  }

  const rows = await db.execute(sql`
    UPDATE structmem_consolidation_jobs
    SET
      status = 'running',
      attempt_count = attempt_count + 1,
      locked_at = NOW(),
      locked_by = ${workerId},
      last_attempted_at = NOW(),
      error_message = NULL
    WHERE id = (
      SELECT id
      FROM structmem_consolidation_jobs
      WHERE
        (
          status IN ('pending', 'failed')
          AND attempt_count < max_attempts
        )
        OR (
          status = 'running'
          AND locked_at IS NOT NULL
          AND locked_at < NOW() - (${env.POST_TURN_JOB_LOCK_TTL_MS}::int * INTERVAL '1 millisecond')
        )
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING
      id,
      session_id AS "sessionId",
      character_id AS "characterId",
      player_id AS "playerId",
      memory_namespace AS "memoryNamespace",
      status,
      turn_start AS "turnStart",
      turn_end AS "turnEnd",
      attempt_count AS "attemptCount",
      max_attempts AS "maxAttempts",
      last_attempted_at AS "lastAttemptedAt",
      locked_at AS "lockedAt",
      locked_by AS "lockedBy",
      error_message AS "errorMessage",
      created_at AS "createdAt",
      completed_at AS "completedAt"
  `);

  return (rows.rows[0] as unknown as StructMemConsolidationJob | undefined) ?? null;
}

export const claimStructMemConsolidationJob =
  claimStructMemConsolidationJobImpl;

class StructMemConsolidationRunner extends BackgroundRunner {
  private readonly workerId = `structmem-consolidation-${process.pid}-${uuidv4()}`;

  constructor() {
    super("structmemConsolidationRunner", env.POST_TURN_JOB_POLL_INTERVAL_MS);
  }

  /**
   * Eval isolation: when a turn runs inside an eval capture, the post-turn memory
   * graph may enqueue a consolidation job and call wake(). The background loop must
   * NOT claim that job — the pending row is cascade-deleted by cleanupEvalSession's
   * session delete.
   *
   * Mirrors PostTurnRunner.wake() (postTurnRunner.ts:77-80). In production there is
   * no eval capture, so wake() behaves normally.
   */
  override wake(): void {
    if (getAgentEvalCapture()) return;
    super.wake();
  }

  /** Override in tests to inject a fake graph. */
  protected createGraph(): ReturnType<typeof getStructMemConsolidationGraph> {
    return getStructMemConsolidationGraph();
  }

  /** Override in tests to intercept failure path without touching DB. */
  protected async onJobFailed(job: StructMemConsolidationJob, err: unknown): Promise<void> {
    await failStructMemConsolidationJob(job, err);
  }

  /** Override in tests to return a controlled sequence of jobs. */
  protected async claimJob(): Promise<StructMemConsolidationJob | null> {
    return claimStructMemConsolidationJob(this.workerId);
  }

  protected async runLoop(): Promise<void> {
    while (true) {
      const job = await this.claimJob();
      if (!job) return;
      try {
        await withTraceContext(
          {
            baseMetadata: buildTraceBaseMetadata({
              extra: {
                structmemConsolidationJobId: job.id,
                sessionId: job.sessionId,
                characterId: job.characterId,
                playerIdHash: hashPlayerId(job.playerId),
                memoryNamespace: job.memoryNamespace,
                turnStart: job.turnStart,
                turnEnd: job.turnEnd,
              },
            }),
            characterId: job.characterId,
            turn: "background",
          },
          async () => {
            const graph = this.createGraph();
            const state = await graph.invoke(
              { jobId: job.id },
              {
                tags: [
                  "turn:background",
                  "subsystem:structmem",
                  "graph:structMemConsolidationGraph",
                ],
                metadata: {
                  structmemConsolidationJobId: job.id,
                  sessionId: job.sessionId,
                  characterId: job.characterId,
                  playerIdHash: hashPlayerId(job.playerId),
                  memoryNamespace: job.memoryNamespace,
                  turnStart: job.turnStart,
                  turnEnd: job.turnEnd,
                  attemptCount: job.attemptCount,
                  maxAttempts: job.maxAttempts,
                },
              },
            );

            if (state.errors && state.errors.length > 0) {
              const stages = state.errors
                .map((e: { stage: string }) => e.stage)
                .join(", ");
              const messages = state.errors
                .map(
                  (e: { stage: string; message: string }) =>
                    `${e.stage}: ${e.message}`,
                )
                .join("; ");
              const failReason = state.failureReason
                ? ` (failure: ${state.failureReason})`
                : "";
              throw new Error(
                `StructMem consolidation graph failed [${stages}]: ${messages}${failReason}`,
              );
            }
          },
        );
      } catch (err) {
        await this.onJobFailed(job, err);
        console.error(
          `[structmemConsolidationRunner] job ${job.id} failed:`,
          err,
        );
      }
    }
  }
}

export const structmemConsolidationRunner =
  new StructMemConsolidationRunner();

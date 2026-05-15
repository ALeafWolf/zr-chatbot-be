import { v4 as uuidv4 } from "uuid";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import type { StructMemConsolidationJob } from "../db/schema/structmem";
import { env } from "../config/env";
import { BackgroundRunner } from "./backgroundRunner";
import {
  failStructMemConsolidationJob,
  runStructMemConsolidation,
} from "../memory/structmem/structmemConsolidationRepo";
import { withTraceContext } from "../observability/langsmithTracing";
import {
  buildTraceBaseMetadata,
  hashPlayerId,
} from "../observability/traceMetadata";

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

  protected async runLoop(): Promise<void> {
    while (true) {
      const job = await claimStructMemConsolidationJob(this.workerId);
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
            await runStructMemConsolidation(job);
          },
        );
      } catch (err) {
        await failStructMemConsolidationJob(job, err);
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

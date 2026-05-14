import { v4 as uuidv4 } from "uuid";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import type { ChatSession } from "../db/schema/chat";
import {
  structmemConsolidationJobs,
  structmemConsolidations,
  structmemConsolidationSources,
  structmemEntries,
  type StructMemConsolidationJob,
} from "../db/schema/structmem";
import { env } from "../config/env";
import { embedText } from "../llm/embedText";
import { traceStage } from "../observability/langsmithTracing";
import {
  consolidationEligibility,
  selectBufferEntries,
  selectSeedEntriesByEvent,
  type ConsolidationCandidateEntry,
} from "./structmemConsolidationSelection";
import { synthesizeStructMemConsolidation } from "./structmemConsolidationSynthesis";

interface UnconsolidatedStats {
  entryCount: number;
  turnCount: number;
  turnStart: number | null;
  turnEnd: number | null;
}

interface StructMemEntryRow extends ConsolidationCandidateEntry {
  importanceScore: number | null;
  confidenceScore: number | null;
}

interface SemanticSeedRow {
  id: string;
  event_id: string;
  turn_index: number;
  entry_type: string;
  text: string;
  importance_score: number | null;
  confidence_score: number | null;
}

export type MaybeEnqueueStructMemConsolidationResult = {
  status:
    | "disabled"
    | "sandbox"
    | "below_threshold"
    | "existing_job"
    | "enqueued";
  jobId?: string;
  entryCount?: number;
  turnCount?: number;
};

async function getUnconsolidatedStats(
  sessionId: string,
): Promise<UnconsolidatedStats> {
  const rows = await db.execute(sql`
    SELECT
      COUNT(*)::int AS entry_count,
      COUNT(DISTINCT turn_index)::int AS turn_count,
      MIN(turn_index)::int AS turn_start,
      MAX(turn_index)::int AS turn_end
    FROM structmem_entries
    WHERE session_id = ${sessionId}
      AND first_consolidated_at IS NULL
  `);
  const row = rows.rows[0] as
    | {
        entry_count: number;
        turn_count: number;
        turn_start: number | null;
        turn_end: number | null;
      }
    | undefined;
  return {
    entryCount: row?.entry_count ?? 0,
    turnCount: row?.turn_count ?? 0,
    turnStart: row?.turn_start ?? null,
    turnEnd: row?.turn_end ?? null,
  };
}

async function findExistingActiveJob(
  sessionId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: structmemConsolidationJobs.id })
    .from(structmemConsolidationJobs)
    .where(
      and(
        eq(structmemConsolidationJobs.sessionId, sessionId),
        sql`(${structmemConsolidationJobs.status} IN ('pending', 'running') OR (${structmemConsolidationJobs.status} = 'failed' AND ${structmemConsolidationJobs.attemptCount} < ${structmemConsolidationJobs.maxAttempts}))`,
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

async function maybeEnqueueStructMemConsolidationImpl(input: {
  session: ChatSession;
}): Promise<MaybeEnqueueStructMemConsolidationResult> {
  const stats = await getUnconsolidatedStats(input.session.sessionId);
  const eligible = consolidationEligibility({
    enabled: env.STRUCTMEM_ENABLED && env.STRUCTMEM_CONSOLIDATION_ENABLED,
    sessionMode: input.session.mode,
    unconsolidatedTurnCount: stats.turnCount,
    unconsolidatedEntryCount: stats.entryCount,
    minTurns: env.STRUCTMEM_MIN_UNCONSOLIDATED_TURNS,
    minEntries: env.STRUCTMEM_MIN_UNCONSOLIDATED_ENTRIES,
  });

  if (eligible !== "eligible") {
    return {
      status: eligible,
      entryCount: stats.entryCount,
      turnCount: stats.turnCount,
    };
  }

  const existingJobId = await findExistingActiveJob(input.session.sessionId);
  if (existingJobId) {
    return {
      status: "existing_job",
      jobId: existingJobId,
      entryCount: stats.entryCount,
      turnCount: stats.turnCount,
    };
  }

  const jobId = uuidv4();
  await db.insert(structmemConsolidationJobs).values({
    id: jobId,
    sessionId: input.session.sessionId,
    characterId: input.session.characterId,
    playerId: input.session.playerId,
    memoryNamespace: input.session.memoryNamespace,
    status: "pending",
    turnStart: stats.turnStart,
    turnEnd: stats.turnEnd,
    attemptCount: 0,
    maxAttempts: env.STRUCTMEM_JOB_MAX_ATTEMPTS,
  });

  return {
    status: "enqueued",
    jobId,
    entryCount: stats.entryCount,
    turnCount: stats.turnCount,
  };
}

export const maybeEnqueueStructMemConsolidation = traceStage(
  "memory.maybe_enqueue_structmem_consolidation",
  maybeEnqueueStructMemConsolidationImpl,
  { tags: ["structmem", "phase3"] },
);

async function fetchBufferEntries(
  sessionId: string,
): Promise<StructMemEntryRow[]> {
  const rows = await db
    .select({
      id: structmemEntries.id,
      eventId: structmemEntries.eventId,
      turnIndex: structmemEntries.turnIndex,
      entryType: structmemEntries.entryType,
      text: structmemEntries.text,
      importanceScore: structmemEntries.importanceScore,
      confidenceScore: structmemEntries.confidenceScore,
    })
    .from(structmemEntries)
    .where(
      and(
        eq(structmemEntries.sessionId, sessionId),
        isNull(structmemEntries.firstConsolidatedAt),
      ),
    );

  return selectBufferEntries(rows, env.STRUCTMEM_MAX_BUFFER_ENTRIES);
}

function entryToBufferText(entry: ConsolidationCandidateEntry): string {
  return `[turn ${entry.turnIndex}] [${entry.entryType}] ${entry.text}`;
}

async function fetchSemanticSeedEntries(input: {
  sessionId: string;
  characterId: string;
  bufferEntries: StructMemEntryRow[];
}): Promise<StructMemEntryRow[]> {
  if (input.bufferEntries.length === 0 || env.STRUCTMEM_SEED_K <= 0) {
    return [];
  }

  const oldestBufferTurn = Math.min(
    ...input.bufferEntries.map((entry) => entry.turnIndex),
  );
  const bufferText = input.bufferEntries.map(entryToBufferText).join("\n");
  const bufferEmbedding = await embedText(bufferText);
  const embeddingStr = `[${bufferEmbedding.join(",")}]`;

  const seedRows = await db.execute(sql`
    SELECT
      id,
      event_id,
      turn_index,
      entry_type,
      text,
      importance_score,
      confidence_score
    FROM structmem_entries
    WHERE session_id = ${input.sessionId}
      AND character_id = ${input.characterId}
      AND turn_index < ${oldestBufferTurn}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT ${env.STRUCTMEM_SEED_K}
  `);

  const hits = (seedRows.rows as unknown as SemanticSeedRow[]).map((row) => ({
    id: row.id,
    eventId: row.event_id,
    turnIndex: row.turn_index,
    entryType: row.entry_type,
    text: row.text,
    importanceScore: row.importance_score,
    confidenceScore: row.confidence_score,
  }));

  if (hits.length === 0) return [];

  const seedEventIds = [...new Set(hits.map((hit) => hit.eventId))].slice(
    0,
    env.STRUCTMEM_MAX_SEED_EVENTS,
  );
  const eventEntries: StructMemEntryRow[] = [];
  for (const eventId of seedEventIds) {
    const rows = await db
      .select({
        id: structmemEntries.id,
        eventId: structmemEntries.eventId,
        turnIndex: structmemEntries.turnIndex,
        entryType: structmemEntries.entryType,
        text: structmemEntries.text,
        importanceScore: structmemEntries.importanceScore,
        confidenceScore: structmemEntries.confidenceScore,
      })
      .from(structmemEntries)
      .where(eq(structmemEntries.eventId, eventId));
    rows.sort((a, b) => a.turnIndex - b.turnIndex || a.id.localeCompare(b.id));
    eventEntries.push(...rows);
  }

  return selectSeedEntriesByEvent(eventEntries, {
    bufferEntryIds: new Set(input.bufferEntries.map((entry) => entry.id)),
    maxSeedEvents: env.STRUCTMEM_MAX_SEED_EVENTS,
    maxEntriesPerEvent: env.STRUCTMEM_MAX_ENTRIES_PER_EVENT,
  });
}

async function markJob(input: {
  jobId: string;
  status: "completed" | "skipped" | "failed" | "dead_letter";
  errorMessage?: string | null;
}): Promise<void> {
  await db
    .update(structmemConsolidationJobs)
    .set({
      status: input.status,
      lockedAt: null,
      lockedBy: null,
      errorMessage: input.errorMessage ?? null,
      completedAt:
        input.status === "completed" || input.status === "skipped"
          ? new Date()
          : null,
    })
    .where(eq(structmemConsolidationJobs.id, input.jobId));
}

async function runStructMemConsolidationImpl(
  job: StructMemConsolidationJob,
): Promise<{ status: "completed" | "skipped"; consolidationId?: string }> {
  const bufferEntries = await fetchBufferEntries(job.sessionId);
  if (bufferEntries.length === 0) {
    await markJob({ jobId: job.id, status: "skipped" });
    return { status: "skipped" };
  }

  const semanticSeedEntries = await fetchSemanticSeedEntries({
    sessionId: job.sessionId,
    characterId: job.characterId,
    bufferEntries,
  });

  const synthesis = await synthesizeStructMemConsolidation({
    bufferEntries,
    semanticSeedEntries,
    maxInputTokens: env.STRUCTMEM_MAX_SYNTHESIS_INPUT_TOKENS,
  });
  const embedding = await embedText(synthesis.summary_text);
  const now = new Date();
  const consolidationId = uuidv4();
  const turnStart = Math.min(...bufferEntries.map((entry) => entry.turnIndex));
  const turnEnd = Math.max(...bufferEntries.map((entry) => entry.turnIndex));
  const sourceRows = [
    ...bufferEntries.map((entry) => ({ entry, sourceRole: "buffer" as const })),
    ...semanticSeedEntries.map((entry) => ({
      entry,
      sourceRole: "semantic_seed" as const,
    })),
  ];
  const sourceEntryIds = [...new Set(sourceRows.map((row) => row.entry.id))];

  await db.transaction(async (tx) => {
    await tx.insert(structmemConsolidations).values({
      id: consolidationId,
      sessionId: job.sessionId,
      characterId: job.characterId,
      playerId: job.playerId,
      memoryNamespace: job.memoryNamespace,
      scope: "current_session",
      summaryText: synthesis.summary_text,
      summaryJson: synthesis.summary_json,
      embedding,
      turnStart,
      turnEnd,
      confidenceScore: synthesis.confidence_score,
      promotionStatus: "none",
      createdAt: now,
    });

    if (sourceRows.length > 0) {
      await tx.insert(structmemConsolidationSources).values(
        sourceRows.map((row) => ({
          consolidationId,
          entryId: row.entry.id,
          eventId: row.entry.eventId,
          sourceRole: row.sourceRole,
          createdAt: now,
        })),
      );
    }

    await tx
      .update(structmemEntries)
      .set({
        firstConsolidatedAt: sql`COALESCE(${structmemEntries.firstConsolidatedAt}, ${now})`,
        consolidationCount: sql`${structmemEntries.consolidationCount} + 1`,
      })
      .where(inArray(structmemEntries.id, sourceEntryIds));

    await tx
      .update(structmemConsolidationJobs)
      .set({
        status: "completed",
        lockedAt: null,
        lockedBy: null,
        errorMessage: null,
        completedAt: now,
      })
      .where(eq(structmemConsolidationJobs.id, job.id));
  });

  return { status: "completed", consolidationId };
}

export const runStructMemConsolidation = traceStage(
  "memory.run_structmem_consolidation",
  runStructMemConsolidationImpl,
  { tags: ["structmem", "phase3"] },
);

export async function failStructMemConsolidationJob(
  job: StructMemConsolidationJob,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  const exhausted = job.attemptCount >= job.maxAttempts;
  await markJob({
    jobId: job.id,
    status: exhausted ? "dead_letter" : "failed",
    errorMessage: message.slice(0, 8000),
  });
}

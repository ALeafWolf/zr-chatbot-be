import { v4 as uuidv4 } from "uuid";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { chatSessions, type ChatSession } from "../../db/schema/chat";
import {
  structmemConsolidationJobs,
  structmemConsolidations,
  structmemConsolidationSources,
  structmemEntries,
  type StructMemConsolidationJob,
} from "../../db/schema/structmem";
import { env } from "../../config/env";
import { embedText } from "../../llm/embeddings/embedText";
import {
  traceStage,
  traceStageWithIO,
} from "../../observability/langsmithTracing";
import type { MemoryNamespace } from "../shared/memoryNamespace";
import {
  consolidationEligibility,
  selectBufferEntries,
  selectSeedEntriesByEvent,
  type ConsolidationCandidateEntry,
} from "./structmemConsolidationSelection";
import {
  distillCrossSessionStructMem,
  synthesizeStructMemConsolidation,
  type StructMemCrossSessionItem,
} from "./structmemConsolidationSynthesis";
import {
  mapStableCategoryToMemoryType,
  shouldPromoteStructMemToIme,
  shouldWriteCrossSessionStructMem,
} from "./structmemPhase4Policy";
import { writeInteractiveMemory } from "../interactive/writeInteractiveMemory";

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

interface ConsolidationSourceRow {
  entry_id: string;
  event_id: string;
  source_role: "buffer" | "semantic_seed";
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
  { subsystem: "structmem", turn: "background" },
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

async function selectConsolidationBufferImpl(input: {
  sessionId: string;
  characterId: string;
}): Promise<{
  bufferEntries: StructMemEntryRow[];
  semanticSeedEntries: StructMemEntryRow[];
  bufferCount: number;
  semanticSeedCount: number;
  turnStart: number | null;
  turnEnd: number | null;
  skippedReason?: string;
}> {
  const bufferEntries = await fetchBufferEntries(input.sessionId);
  if (bufferEntries.length === 0) {
    return {
      bufferEntries,
      semanticSeedEntries: [],
      bufferCount: 0,
      semanticSeedCount: 0,
      turnStart: null,
      turnEnd: null,
      skippedReason: "empty_buffer",
    };
  }
  const semanticSeedEntries = await fetchSemanticSeedEntries({
    sessionId: input.sessionId,
    characterId: input.characterId,
    bufferEntries,
  });
  return {
    bufferEntries,
    semanticSeedEntries,
    bufferCount: bufferEntries.length,
    semanticSeedCount: semanticSeedEntries.length,
    turnStart: Math.min(...bufferEntries.map((entry) => entry.turnIndex)),
    turnEnd: Math.max(...bufferEntries.map((entry) => entry.turnIndex)),
  };
}

const selectConsolidationBufferTraced = traceStageWithIO(
  "memory.select_consolidation_buffer",
  selectConsolidationBufferImpl,
  {
    subsystem: "structmem",
    turn: "background",
    processInputs: (inputs) => {
      const input = unwrapSelectConsolidationBufferInput(inputs);
      return {
        sessionId: input.sessionId,
        characterId: input.characterId,
        maxBufferEntries: env.STRUCTMEM_MAX_BUFFER_ENTRIES,
        seedK: env.STRUCTMEM_SEED_K,
      };
    },
    processOutputs: (outputs) => {
      const result = outputs as unknown as Awaited<
        ReturnType<typeof selectConsolidationBufferImpl>
      >;
      return buildConsolidationBufferTraceOutput(result);
    },
  },
);

export function buildConsolidationBufferTraceOutput(input: {
  bufferCount: number;
  semanticSeedCount: number;
  turnStart: number | null;
  turnEnd: number | null;
  skippedReason?: string;
}): {
  bufferCount: number;
  semanticSeedCount: number;
  turnStart: number | null;
  turnEnd: number | null;
  skippedReason: string | null;
} {
  return {
    bufferCount: input.bufferCount,
    semanticSeedCount: input.semanticSeedCount,
    turnStart: input.turnStart,
    turnEnd: input.turnEnd,
    skippedReason: input.skippedReason ?? null,
  };
}

function unwrapSelectConsolidationBufferInput(
  inputs: Record<string, unknown>,
): { sessionId: string; characterId: string } {
  if ("input" in inputs && inputs.input) {
    return inputs.input as { sessionId: string; characterId: string };
  }
  return inputs as unknown as { sessionId: string; characterId: string };
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

async function currentConsolidationHasCrossSessionChildren(
  consolidationId: string,
): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT id
    FROM structmem_consolidations
    WHERE scope = 'cross_session'
      AND summary_json->>'origin_current_session_consolidation_id' = ${consolidationId}
    LIMIT 1
  `);
  return rows.rows.length > 0;
}

async function fetchConsolidationSources(
  consolidationId: string,
): Promise<ConsolidationSourceRow[]> {
  const rows = await db.execute(sql`
    SELECT entry_id, event_id, source_role
    FROM structmem_consolidation_sources
    WHERE consolidation_id = ${consolidationId}
  `);
  return rows.rows as unknown as ConsolidationSourceRow[];
}

async function promoteCrossSessionStructMemToIme(input: {
  session: ChatSession;
  consolidationId: string;
  item: StructMemCrossSessionItem;
  embedding: number[];
}): Promise<"promoted" | "rejected"> {
  const result = await writeInteractiveMemory({
    candidate: {
      memoryType: mapStableCategoryToMemoryType(input.item.category),
      summary: input.item.summary_text,
      importanceScore: input.item.importance_score,
      emotionScore: 0,
      tags: ["structmem_phase4", input.item.category, ...input.item.tags],
      embedding: input.embedding,
      memoryScope: "cross_session",
    },
    characterId: input.session.characterId,
    playerId: input.session.playerId,
    sessionId: input.session.sessionId,
    continuityScope: input.session.continuityScope,
    continuityFamily: input.session.continuityFamily as "main_world" | "au",
    memoryNamespace: input.session.memoryNamespace as MemoryNamespace,
  });

  const status =
    result === "written" || result === "deduplicated" ? "promoted" : "rejected";
  await db
    .update(structmemConsolidations)
    .set({ promotionStatus: status })
    .where(eq(structmemConsolidations.id, input.consolidationId));
  return status;
}

async function maybeWriteCrossSessionConsolidations(input: {
  session: ChatSession;
  currentConsolidationId: string;
  currentSummaryText: string;
  currentSummaryJson: Record<string, unknown>;
  currentConfidenceScore: number | null;
}): Promise<{ status: string; crossSessionIds: string[] }> {
  if (
    !shouldWriteCrossSessionStructMem({
      enabled: env.STRUCTMEM_CROSS_SESSION_WRITE_ENABLED,
      sessionMode: input.session.mode,
      writebackPolicy: input.session.writebackPolicy,
    })
  ) {
    return { status: "disabled", crossSessionIds: [] };
  }

  if (await currentConsolidationHasCrossSessionChildren(input.currentConsolidationId)) {
    return { status: "skipped_existing", crossSessionIds: [] };
  }

  const distilled = await distillCrossSessionStructMem({
    summaryText: input.currentSummaryText,
    summaryJson: input.currentSummaryJson,
    confidenceScore: input.currentConfidenceScore,
  });
  const stableItems = distilled.stable_items.filter(
    (item) => item.confidence_score >= env.STRUCTMEM_CROSS_SESSION_MIN_CONFIDENCE,
  );
  if (stableItems.length === 0) {
    return { status: "no_stable_items", crossSessionIds: [] };
  }

  const sources = await fetchConsolidationSources(input.currentConsolidationId);
  const rowsToInsert: Array<{
    id: string;
    item: StructMemCrossSessionItem;
    embedding: number[];
  }> = [];
  for (const item of stableItems) {
    rowsToInsert.push({
      id: uuidv4(),
      item,
      embedding: await embedText(item.summary_text),
    });
  }
  const now = new Date();

  await db.transaction(async (tx) => {
    for (const row of rowsToInsert) {
      await tx.insert(structmemConsolidations).values({
        id: row.id,
        sessionId: input.session.sessionId,
        characterId: input.session.characterId,
        playerId: input.session.playerId,
        memoryNamespace: input.session.memoryNamespace,
        scope: "cross_session",
        summaryText: row.item.summary_text,
        summaryJson: {
          ...input.currentSummaryJson,
          stable_category: row.item.category,
          origin_current_session_consolidation_id:
            input.currentConsolidationId,
          distillation_confidence_score: row.item.confidence_score,
          tags: row.item.tags,
        },
        embedding: row.embedding,
        turnStart: null,
        turnEnd: null,
        confidenceScore: row.item.confidence_score,
        promotionStatus: env.STRUCTMEM_PROMOTION_TO_IME_ENABLED
          ? "candidate"
          : "none",
        createdAt: now,
      });

      if (sources.length > 0) {
        await tx.insert(structmemConsolidationSources).values(
          sources.map((source) => ({
            consolidationId: row.id,
            entryId: source.entry_id,
            eventId: source.event_id,
            sourceRole: source.source_role,
            createdAt: now,
          })),
        );
      }
    }
  });

  if (
    shouldPromoteStructMemToIme({
      enabled: env.STRUCTMEM_PROMOTION_TO_IME_ENABLED,
      sessionMode: input.session.mode,
      writebackPolicy: input.session.writebackPolicy,
    })
  ) {
    for (const row of rowsToInsert) {
      await promoteCrossSessionStructMemToIme({
        session: input.session,
        consolidationId: row.id,
        item: row.item,
        embedding: row.embedding,
      });
    }
  }

  return {
    status: "written",
    crossSessionIds: rowsToInsert.map((row) => row.id),
  };
}

export const maybeWriteCrossSessionStructMemConsolidations = traceStage(
  "memory.write_cross_session_structmem_consolidations",
  maybeWriteCrossSessionConsolidations,
  { subsystem: "structmem", turn: "background" },
);

async function runStructMemConsolidationImpl(
  job: StructMemConsolidationJob,
): Promise<{ status: "completed" | "skipped"; consolidationId?: string }> {
  const selection = await selectConsolidationBufferTraced({
    sessionId: job.sessionId,
    characterId: job.characterId,
  });
  const bufferEntries = selection.bufferEntries;
  if (bufferEntries.length === 0) {
    await markJob({ jobId: job.id, status: "skipped" });
    return { status: "skipped" };
  }
  const semanticSeedEntries = selection.semanticSeedEntries;

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

  const sessionRows = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.sessionId, job.sessionId))
    .limit(1);
  const session = sessionRows[0];
  if (session) {
    await maybeWriteCrossSessionStructMemConsolidations({
      session,
      currentConsolidationId: consolidationId,
      currentSummaryText: synthesis.summary_text,
      currentSummaryJson: synthesis.summary_json,
      currentConfidenceScore: synthesis.confidence_score,
    });
  }

  return { status: "completed", consolidationId };
}

export const runStructMemConsolidation = traceStage(
  "memory.run_structmem_consolidation",
  runStructMemConsolidationImpl,
  { subsystem: "structmem", turn: "background" },
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

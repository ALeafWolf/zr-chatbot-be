import { db } from "../../db/client";
import { SESSION_CHUNK_RANKING_WEIGHTS } from "../../character/canonRules";
import { env } from "../../config/env";
import { sql } from "drizzle-orm";
import { traceStage } from "../../observability/langsmithTracing";

export interface RetrievedStructMemEntry {
  id: string;
  turnIndex: number;
  entryType: string;
  text: string;
  importanceScore: number | null;
  confidenceScore: number | null;
  cosineSimilarity: number;
  finalScore: number;
}

interface Row {
  id: string;
  turn_index: number;
  entry_type: string;
  text: string;
  importance_score: number | null;
  confidence_score: number | null;
  cosine_similarity: number;
}

/**
 * Semantic search over structmem_entries before the raw recent window.
 * Same cutoff as session_memory_chunks: turn_index < exclusiveRecentWindowFirstTurn.
 */
async function retrieveStructMemEntriesInner(input: {
  queryEmbedding: number[];
  sessionId: string;
  characterId: string;
  exclusiveRecentWindowFirstTurn: number;
  latestFrontierTurnIndex: number;
  limit?: number;
}): Promise<RetrievedStructMemEntry[]> {
  if (!env.STRUCTMEM_ENABLED) {
    return [];
  }

  const {
    queryEmbedding,
    sessionId,
    characterId,
    exclusiveRecentWindowFirstTurn,
    latestFrontierTurnIndex,
    limit = env.STRUCTMEM_ENTRY_RETRIEVAL_TOP_K,
  } = input;

  if (latestFrontierTurnIndex < 0) {
    return [];
  }

  const fetchCap = Math.min(40, Math.max(limit * 5, 16));
  const embeddingStr = `[${queryEmbedding.join(",")}]`;
  const frontier = Math.max(1, latestFrontierTurnIndex);

  const rows = await db.execute(sql`
    SELECT
      id,
      turn_index,
      entry_type,
      text,
      importance_score,
      confidence_score,
      1 - (embedding <=> ${embeddingStr}::vector) AS cosine_similarity
    FROM structmem_entries
    WHERE session_id = ${sessionId}
      AND character_id = ${characterId}
      AND turn_index < ${exclusiveRecentWindowFirstTurn}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT ${fetchCap}
  `);

  if (rows.rows.length === 0) return [];

  const scored = (rows.rows as unknown as Row[]).map((r) => {
    const cosine = r.cosine_similarity as number;
    const ti = r.turn_index as number;
    const recencyBoost = Math.min(1, Math.max(0, (ti + 1) / frontier));
    const finalScore =
      SESSION_CHUNK_RANKING_WEIGHTS.similarity * cosine +
      SESSION_CHUNK_RANKING_WEIGHTS.recency * recencyBoost;
    return {
      id: r.id as string,
      turnIndex: ti,
      entryType: r.entry_type as string,
      text: r.text as string,
      importanceScore: r.importance_score as number | null,
      confidenceScore: r.confidence_score as number | null,
      cosineSimilarity: cosine,
      finalScore,
    };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);

  return scored.slice(0, limit).map((x) => ({
    id: x.id,
    turnIndex: x.turnIndex,
    entryType: x.entryType,
    text: x.text,
    importanceScore: x.importanceScore,
    confidenceScore: x.confidenceScore,
    cosineSimilarity: x.cosineSimilarity,
    finalScore: x.finalScore,
  }));
}

export const retrieveStructMemEntriesTraced = traceStage(
  "retrieval.structmem_entries",
  retrieveStructMemEntriesInner,
);

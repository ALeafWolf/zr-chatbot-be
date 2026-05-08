import { db } from "../db/client";
import { RETRIEVAL_LIMITS, SESSION_CHUNK_RANKING_WEIGHTS } from "../character/canonRules";
import { sql } from "drizzle-orm";
import { traceStage } from "../observability/langsmithTracing";

export interface RetrievedSessionMemoryChunk {
  id: string;
  turnStart: number;
  turnEnd: number;
  chunkText: string;
  chunkType: string;
  cosineSimilarity: number;
  /** Composite score after re-ranking. */
  finalScore: number;
}

interface Row {
  id: string;
  turn_start: number;
  turn_end: number;
  chunk_text: string;
  chunk_type: string;
  cosine_similarity: number;
}

/**
 * Semantic search over persisted session chunks that fall **before** the raw recent window
 * (`turn_end < exclusiveRecentWindowFirstTurn`).
 */
async function retrieveSessionMemoryChunksInner(input: {
  queryEmbedding: number[];
  sessionId: string;
  characterId: string;
  exclusiveRecentWindowFirstTurn: number;
  latestFrontierTurnIndex: number;
  limit?: number;
}): Promise<RetrievedSessionMemoryChunk[]> {
  const {
    queryEmbedding,
    sessionId,
    characterId,
    exclusiveRecentWindowFirstTurn,
    latestFrontierTurnIndex,
    limit = RETRIEVAL_LIMITS.sessionRecallTopK,
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
      turn_start,
      turn_end,
      chunk_text,
      chunk_type,
      1 - (embedding <=> ${embeddingStr}::vector) AS cosine_similarity
    FROM session_memory_chunks
    WHERE session_id = ${sessionId}
      AND character_id = ${characterId}
      AND turn_end < ${exclusiveRecentWindowFirstTurn}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT ${fetchCap}
  `);

  if (rows.rows.length === 0) return [];

  const scored = (rows.rows as unknown as Row[]).map((r) => {
    const cosine = r.cosine_similarity as number;
    const te = r.turn_end as number;
    const recencyBoost = Math.min(1, Math.max(0, (te + 1) / frontier));
    const finalScore =
      SESSION_CHUNK_RANKING_WEIGHTS.similarity * cosine +
      SESSION_CHUNK_RANKING_WEIGHTS.recency * recencyBoost;
    return {
      id: r.id as string,
      turnStart: r.turn_start as number,
      turnEnd: te,
      chunkText: r.chunk_text as string,
      chunkType: r.chunk_type as string,
      cosineSimilarity: cosine,
      finalScore,
    };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);

  return scored.slice(0, limit).map((x) => ({
    id: x.id,
    turnStart: x.turnStart,
    turnEnd: x.turnEnd,
    chunkText: x.chunkText,
    chunkType: x.chunkType,
    cosineSimilarity: x.cosineSimilarity,
    finalScore: x.finalScore,
  }));
}

export const retrieveSessionMemoryChunksTraced = traceStage(
  "retrieval.session_memory_chunks",
  retrieveSessionMemoryChunksInner,
);

import { db } from "../db/client";
import { SESSION_CHUNK_RANKING_WEIGHTS } from "../character/canonRules";
import { env } from "../config/env";
import { sql } from "drizzle-orm";
import { traceStage } from "../observability/langsmithTracing";

export interface RetrievedStructMemConsolidation {
  id: string;
  summaryText: string;
  summaryJson: Record<string, unknown>;
  turnStart: number | null;
  turnEnd: number | null;
  confidenceScore: number | null;
  cosineSimilarity: number;
  finalScore: number;
}

interface Row {
  id: string;
  summary_text: string;
  summary_json: Record<string, unknown>;
  turn_start: number | null;
  turn_end: number | null;
  confidence_score: number | null;
  cosine_similarity: number;
}

async function retrieveStructMemConsolidationsInner(input: {
  queryEmbedding: number[];
  sessionId: string;
  characterId: string;
  exclusiveRecentWindowFirstTurn: number;
  latestFrontierTurnIndex: number;
  limit?: number;
}): Promise<RetrievedStructMemConsolidation[]> {
  if (!env.STRUCTMEM_ENABLED || !env.STRUCTMEM_CONSOLIDATION_ENABLED) {
    return [];
  }

  const {
    queryEmbedding,
    sessionId,
    characterId,
    exclusiveRecentWindowFirstTurn,
    latestFrontierTurnIndex,
    limit = 4,
  } = input;

  if (latestFrontierTurnIndex < 0) return [];

  const fetchCap = Math.min(20, Math.max(limit * 4, 8));
  const embeddingStr = `[${queryEmbedding.join(",")}]`;
  const frontier = Math.max(1, latestFrontierTurnIndex);

  const rows = await db.execute(sql`
    SELECT
      id,
      summary_text,
      summary_json,
      turn_start,
      turn_end,
      confidence_score,
      1 - (embedding <=> ${embeddingStr}::vector) AS cosine_similarity
    FROM structmem_consolidations
    WHERE session_id = ${sessionId}
      AND character_id = ${characterId}
      AND scope = 'current_session'
      AND embedding IS NOT NULL
      AND (turn_end IS NULL OR turn_end < ${exclusiveRecentWindowFirstTurn})
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT ${fetchCap}
  `);

  const scored = (rows.rows as unknown as Row[]).map((r) => {
    const turnEnd = r.turn_end ?? 0;
    const recencyBoost = Math.min(1, Math.max(0, (turnEnd + 1) / frontier));
    const cosine = r.cosine_similarity as number;
    return {
      id: r.id,
      summaryText: r.summary_text,
      summaryJson: r.summary_json ?? {},
      turnStart: r.turn_start,
      turnEnd: r.turn_end,
      confidenceScore: r.confidence_score,
      cosineSimilarity: cosine,
      finalScore:
        SESSION_CHUNK_RANKING_WEIGHTS.similarity * cosine +
        SESSION_CHUNK_RANKING_WEIGHTS.recency * recencyBoost,
    };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);
  return scored.slice(0, limit);
}

export const retrieveStructMemConsolidationsTraced = traceStage(
  "retrieval.structmem_consolidations",
  retrieveStructMemConsolidationsInner,
  { tags: ["structmem", "phase3"] },
);


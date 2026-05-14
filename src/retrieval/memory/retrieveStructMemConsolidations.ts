import { db } from "../../db/client";
import { SESSION_CHUNK_RANKING_WEIGHTS } from "../../character/canonRules";
import { env } from "../../config/env";
import { sql } from "drizzle-orm";
import { traceStage } from "../../observability/langsmithTracing";

export interface RetrievedStructMemConsolidation {
  id: string;
  scope: "current_session" | "cross_session";
  memoryNamespace: string;
  summaryText: string;
  summaryJson: Record<string, unknown>;
  turnStart: number | null;
  turnEnd: number | null;
  confidenceScore: number | null;
  originCurrentSessionConsolidationId: string | null;
  cosineSimilarity: number;
  finalScore: number;
}

interface Row {
  id: string;
  scope: "current_session" | "cross_session";
  memory_namespace: string;
  summary_text: string;
  summary_json: Record<string, unknown>;
  turn_start: number | null;
  turn_end: number | null;
  confidence_score: number | null;
  cosine_similarity: number;
}

function originCurrentSessionConsolidationId(
  summaryJson: Record<string, unknown>,
): string | null {
  const raw = summaryJson.origin_current_session_consolidation_id;
  return typeof raw === "string" && raw.trim() ? raw : null;
}

function scoreRows(input: {
  rows: Row[];
  latestFrontierTurnIndex: number;
  limit: number;
}): RetrievedStructMemConsolidation[] {
  const frontier = Math.max(1, input.latestFrontierTurnIndex);
  const scored = input.rows.map((r) => {
    const turnEnd = r.turn_end ?? 0;
    const recencyBoost =
      r.scope === "current_session"
        ? Math.min(1, Math.max(0, (turnEnd + 1) / frontier))
        : 0;
    const cosine = r.cosine_similarity as number;
    return {
      id: r.id,
      scope: r.scope,
      memoryNamespace: r.memory_namespace,
      summaryText: r.summary_text,
      summaryJson: r.summary_json ?? {},
      turnStart: r.turn_start,
      turnEnd: r.turn_end,
      confidenceScore: r.confidence_score,
      originCurrentSessionConsolidationId:
        originCurrentSessionConsolidationId(r.summary_json ?? {}),
      cosineSimilarity: cosine,
      finalScore:
        SESSION_CHUNK_RANKING_WEIGHTS.similarity * cosine +
        SESSION_CHUNK_RANKING_WEIGHTS.recency * recencyBoost,
    };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);
  return scored.slice(0, input.limit);
}

async function retrieveStructMemConsolidationsInner(input: {
  queryEmbedding: number[];
  sessionId: string;
  characterId: string;
  memoryNamespace: string;
  exclusiveRecentWindowFirstTurn: number;
  latestFrontierTurnIndex: number;
  limit?: number;
}): Promise<RetrievedStructMemConsolidation[]> {
  if (!env.STRUCTMEM_ENABLED) {
    return [];
  }

  const {
    queryEmbedding,
    sessionId,
    characterId,
    memoryNamespace,
    exclusiveRecentWindowFirstTurn,
    latestFrontierTurnIndex,
    limit = 4,
  } = input;

  if (latestFrontierTurnIndex < 0) return [];

  const currentLimit = limit;
  const crossLimit = env.STRUCTMEM_CROSS_SESSION_RETRIEVAL_TOP_K;
  const fetchCap = Math.min(20, Math.max(currentLimit * 4, 8));
  const crossFetchCap = Math.min(20, Math.max(crossLimit * 4, 8));
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const currentRows = env.STRUCTMEM_CONSOLIDATION_ENABLED
    ? await db.execute(sql`
    SELECT
      id,
      scope,
      memory_namespace,
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
  `)
    : { rows: [] };

  const crossRows = env.STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED
    ? await db.execute(sql`
    SELECT
      id,
      scope,
      memory_namespace,
      summary_text,
      summary_json,
      turn_start,
      turn_end,
      confidence_score,
      1 - (embedding <=> ${embeddingStr}::vector) AS cosine_similarity
    FROM structmem_consolidations
    WHERE memory_namespace = ${memoryNamespace}
      AND character_id = ${characterId}
      AND scope = 'cross_session'
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT ${crossFetchCap}
  `)
    : { rows: [] };

  return [
    ...scoreRows({
      rows: currentRows.rows as unknown as Row[],
      latestFrontierTurnIndex,
      limit: currentLimit,
    }),
    ...scoreRows({
      rows: crossRows.rows as unknown as Row[],
      latestFrontierTurnIndex,
      limit: crossLimit,
    }),
  ];
}

export const retrieveStructMemConsolidationsTraced = traceStage(
  "retrieval.structmem_consolidations",
  retrieveStructMemConsolidationsInner,
  { tags: ["structmem", "phase3", "phase4"] },
);

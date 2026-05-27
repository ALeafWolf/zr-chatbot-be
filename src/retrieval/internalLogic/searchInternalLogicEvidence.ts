import { db } from "../../db/client";
import { sql } from "drizzle-orm";
import { env } from "../../config/env";
import { traceStage } from "../../observability/langsmithTracing";

/**
 * A single hit from internal-logic evidence retrieval.
 */
export interface InternalLogicEvidenceHit {
  id: string;
  characterId: string;
  node: string;
  claimText: string;
  evidenceText: string;
  arcKey: string | null;
  chapterKey: string | null;
  episodeLabel: string | null;
  sceneOrder: number | null;
  unitIndex: number | null;
  scopeApplicability: {
    continuityFamily?: string;
    arcKeys?: string[];
    continuityScopes?: string[];
    minContinuityScope?: string;
    notes?: string;
  };
  sourceKind: string;
  confidenceScore: number | null;
  metadata: Record<string, unknown>;
  cosineSimilarity: number;
  finalScore: number;
}

/**
 * Known continuity scope progression order.
 * Used for minContinuityScope filtering.
 */
const SCOPE_ORDER: Record<string, number> = {
  main_pre_relationship: 0,
  main_situationship: 1,
  main_relationship: 2,
  main_engaged: 3,
  main_married: 4,
};

/**
 * Post-query scope filtering for a single evidence hit.
 *
 * Returns true if the hit's scopeApplicability is compatible with the
 * current continuity scope or arc hints. When scope metadata is absent,
 * the row passes through.
 */
export function isScopeCompatible(
  scopeApplicability: Record<string, unknown> | null | undefined,
  continuityScope: string | null | undefined,
  arcKeys: string[] | undefined,
): boolean {
  if (!scopeApplicability || Object.keys(scopeApplicability).length === 0) {
    return true; // No scope restrictions — globally applicable
  }

  const sa = scopeApplicability as Record<string, unknown>;

  // continuityScopes: if present, require current scope to be in the list
  const cs = sa.continuityScopes;
  if (Array.isArray(cs) && cs.length > 0 && continuityScope) {
    if (!cs.includes(continuityScope)) return false;
  }

  // minContinuityScope: if present, require current scope to be at or above
  const minScope = sa.minContinuityScope;
  if (typeof minScope === "string" && continuityScope) {
    const minIdx = SCOPE_ORDER[minScope];
    const curIdx = SCOPE_ORDER[continuityScope];
    if (minIdx !== undefined && curIdx !== undefined && curIdx < minIdx) {
      return false;
    }
  }

  // arcKeys: if present and arc hints are available, require overlap
  const saArcKeys = sa.arcKeys;
  if (Array.isArray(saArcKeys) && saArcKeys.length > 0 && arcKeys && arcKeys.length > 0) {
    const hasOverlap = saArcKeys.some((ak: string) => arcKeys.includes(ak));
    if (!hasOverlap) return false;
  }

  return true;
}

/**
 * Compute the final score for a hit.
 *
 * Primary sort by cosine similarity, with a small secondary boost from
 * confidenceScore (if present).
 */
export function computeFinalScore(cosineSimilarity: number, confidenceScore: number | null): number {
  const boost = confidenceScore != null ? confidenceScore * 0.05 : 0;
  return cosineSimilarity + boost;
}

/**
 * Search for active internal-logic evidence rows by vector similarity.
 *
 * Only rows meeting all criteria are returned:
 * - characterId matches
 * - status = 'active'
 * - embedding IS NOT NULL
 * - scopeApplicability is compatible with the current scope/arcs
 * - cosine similarity >= minScore
 *
 * Results are sorted by finalScore descending and capped at limit.
 */
export async function searchInternalLogicEvidence(input: {
  characterId: string;
  queryEmbedding: number[];
  continuityScope?: string | null;
  arcKeys?: string[];
  limit?: number;
  minScore?: number;
}): Promise<InternalLogicEvidenceHit[]> {
  const {
    characterId,
    queryEmbedding,
    continuityScope,
    arcKeys,
    limit = env.INTERNAL_LOGIC_EVIDENCE_TOP_K,
    minScore = env.INTERNAL_LOGIC_EVIDENCE_MIN_SCORE,
  } = input;

  if (!env.INTERNAL_LOGIC_EVIDENCE_ENABLED) return [];
  if (queryEmbedding.length === 0) return [];

  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const rows = await db.execute(sql`
    SELECT
      id,
      character_id,
      node,
      claim_text,
      evidence_text,
      arc_key,
      chapter_key,
      episode_label,
      scene_order,
      unit_index,
      scope_applicability,
      source_kind,
      confidence_score,
      metadata,
      (1 - (embedding <=> ${embeddingStr}::vector))::float AS cosine_similarity
    FROM internal_logic_evidence
    WHERE character_id = ${characterId}
      AND status = 'active'
      AND embedding IS NOT NULL
      AND (1 - (embedding <=> ${embeddingStr}::vector)) >= ${minScore}::float
    ORDER BY embedding <=> ${embeddingStr}::vector ASC
    LIMIT ${limit}
  `);

  const hits: InternalLogicEvidenceHit[] = [];

  for (const r of rows.rows as unknown as Record<string, unknown>[]) {
    const scopeApp = r.scope_applicability
      ? (r.scope_applicability as Record<string, unknown>)
      : {};

    // Post-query scope filtering
    if (!isScopeCompatible(scopeApp, continuityScope, arcKeys)) continue;

    const cosineSim = Number(r.cosine_similarity);
    const confidence = r.confidence_score != null ? Number(r.confidence_score) : null;

    hits.push({
      id: r.id as string,
      characterId: r.character_id as string,
      node: r.node as string,
      claimText: r.claim_text as string,
      evidenceText: r.evidence_text as string,
      arcKey: r.arc_key as string | null,
      chapterKey: r.chapter_key as string | null,
      episodeLabel: r.episode_label as string | null,
      sceneOrder: r.scene_order as number | null,
      unitIndex: r.unit_index as number | null,
      scopeApplicability: scopeApp as InternalLogicEvidenceHit["scopeApplicability"],
      sourceKind: r.source_kind as string,
      confidenceScore: confidence,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
      cosineSimilarity: cosineSim,
      finalScore: computeFinalScore(cosineSim, confidence),
    });
  }

  // Sort by finalScore descending
  hits.sort((a, b) => b.finalScore - a.finalScore);

  // Cap at limit after scope filtering
  return hits.slice(0, limit);
}

/** Traced export for use in the retrieval pipeline. */
export const tracedSearchInternalLogicEvidence = traceStage(
  "retrieval.internal_logic_evidence",
  searchInternalLogicEvidence,
  { subsystem: "retrieval", turn: "foreground" },
);

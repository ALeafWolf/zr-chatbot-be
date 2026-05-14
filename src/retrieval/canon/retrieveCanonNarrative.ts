import { db } from "../../db/client";
import { sql } from "drizzle-orm";
import {
  CANON_RETRIEVAL,
  CANON_VECTOR_RANK_WEIGHTS,
} from "../../character/canonRules";
import { extractLexicalTerms as extractLexicalTermsInner } from "./lexicalCanonTerms";
import type { RetrievedCanonScene } from "./retrieveCanonTier3Pipeline";

export type { RetrievedCanonScene } from "./retrieveCanonTier3Pipeline";
export { retrieveCanonCoarseToFine } from "./retrieveCanonTier3Pipeline";

export interface RetrievedCanonChunk {
  id: string;
  textContent: string;
  contentType: string;
  speaker: string | null;
  canonPriority: number | null;
  arcKey?: string;
  chapterKey?: string;
  chapterName?: string | null;
  chapterLabel?: string | null;
  episodeLabel?: string | null;
  sceneId?: string;
  sceneOrder?: number | null;
  sceneTitle?: string | null;
  unitIndex?: number;
  /** Window / merged block index for prompt grouping (0-based). */
  blockIndex?: number;
  rankScore: number;
}

/** @see {@link extractLexicalTermsInner} */
export const extractLexicalTerms = extractLexicalTermsInner;

/** Tier 3 scene payload → legacy chunk rows for transitional callers. */
export function canonScenesToChunks(scenes: RetrievedCanonScene[]): RetrievedCanonChunk[] {
  const out: RetrievedCanonChunk[] = [];
  let blockIdx = 0;
  for (const s of scenes) {
    for (const u of s.units) {
      out.push({
        id: `${s.sceneId}_${u.unitIndex}`,
        textContent: u.textContent,
        contentType: u.contentType,
        speaker: u.speaker,
        canonPriority: null,
        arcKey: s.arcKey,
        chapterName: s.chapterName,
        chapterLabel: null,
        episodeLabel: s.episodeLabel,
        sceneId: s.sceneId,
        sceneTitle: s.sceneTitle,
        unitIndex: u.unitIndex,
        blockIndex: blockIdx,
        rankScore: s.rankScore,
      });
    }
    blockIdx += 1;
  }
  return out;
}

function reciprocalRankFusion(lists: string[][], k: number): string[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    if (list.length === 0) continue;
    list.forEach((id, idx) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + idx + 1));
    });
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

interface AnchorRow {
  id: string;
  scene_id: string;
  unit_index: number;
}

function mergeSceneWindows(
  anchors: AnchorRow[],
  windowSize: number,
): Array<{ sceneId: string; lo: number; hi: number; anchorOrder: number; blockIdx: number }> {
  type Acc = { sceneId: string; lo: number; hi: number; anchorOrder: number };
  const windows: Acc[] = [];

  for (let rank = 0; rank < anchors.length; rank++) {
    const { scene_id: sceneId, unit_index: unitIndex } = anchors[rank];
    const lo = unitIndex - windowSize;
    const hi = unitIndex + windowSize;
    let merged = false;
    for (const w of windows) {
      if (w.sceneId !== sceneId) continue;
      if (!(hi < w.lo || lo > w.hi)) {
        w.lo = Math.min(w.lo, lo);
        w.hi = Math.max(w.hi, hi);
        w.anchorOrder = Math.min(w.anchorOrder, rank);
        merged = true;
        break;
      }
    }
    if (!merged) {
      windows.push({ sceneId, lo, hi, anchorOrder: rank });
    }
  }

  windows.sort((a, b) => a.anchorOrder - b.anchorOrder);
  return windows.map((w, blockIdx) => ({ ...w, blockIdx }));
}

/**
 * Tier 1 legacy: hybrid vector + lexical unit anchors (RRF), then same-scene neighbor expansion.
 *
 * Scope: only arcs in `arcKeys`. Lexical branch is fail-open (skipped when there are no terms).
 */
export async function retrieveCanonNarrativeLegacy(input: {
  queryEmbedding: number[];
  userMessage: string;
  characterId: string;
  arcKeys: string[];
  /** Override {@link CANON_RETRIEVAL.anchorTopK} for tests. */
  anchorTopK?: number;
}): Promise<RetrievedCanonChunk[]> {
  const {
    queryEmbedding,
    userMessage,
    characterId,
    arcKeys,
    anchorTopK = CANON_RETRIEVAL.anchorTopK,
  } = input;

  if (arcKeys.length === 0) return [];

  const embeddingStr = `[${queryEmbedding.join(",")}]`;
  const arcKeysSql = sql.join(arcKeys.map((k) => sql`${k}`), sql`, `);
  const scopeWhere = sql`
    su.character_id = ${characterId}
      AND ra.arc_key = ANY(ARRAY[${arcKeysSql}]::text[])
  `;

  const { similarity: wSim, canonPriority: wPri } = CANON_VECTOR_RANK_WEIGHTS;

  const vectorRows = await db.execute(sql`
    SELECT su.id, su.scene_id, su.unit_index
    FROM story_units su
    JOIN story_chapters sc ON su.chapter_id = sc.id
    JOIN relationship_arcs ra ON sc.relationship_arc_id = ra.id
    WHERE ${scopeWhere}
      AND su.embedding IS NOT NULL
    ORDER BY
      (
        (1 - (su.embedding <=> ${embeddingStr}::vector)) * ${wSim}
        + COALESCE(su.canon_priority, 0.5) * ${wPri}
      ) DESC
    LIMIT ${CANON_RETRIEVAL.vectorCandidateLimit}
  `);

  const vectorAnchors = vectorRows.rows as unknown as AnchorRow[];
  const vectorIds = vectorAnchors.map((r) => r.id);

  const terms = extractLexicalTerms(userMessage);
  let lexicalAnchors: AnchorRow[] = [];

  if (terms.length > 0) {
    const termPatterns = terms.map((t) => `%${t}%`);
    const matchSum = terms.reduce(
      (acc, _t, i) =>
        i === 0
          ? sql`CASE WHEN su.text_content ILIKE ${termPatterns[i]} THEN 1 ELSE 0 END`
          : sql`${acc} + CASE WHEN su.text_content ILIKE ${termPatterns[i]} THEN 1 ELSE 0 END`,
      sql`` as ReturnType<typeof sql>,
    );

    const termOr = terms.reduce(
      (acc, _t, i) =>
        i === 0 ? sql`(su.text_content ILIKE ${termPatterns[i]})` : sql`${acc} OR (su.text_content ILIKE ${termPatterns[i]})`,
      sql`` as ReturnType<typeof sql>,
    );

    const lexicalRows = await db.execute(sql`
      SELECT su.id, su.scene_id, su.unit_index
      FROM story_units su
      JOIN story_chapters sc ON su.chapter_id = sc.id
      JOIN relationship_arcs ra ON sc.relationship_arc_id = ra.id
      WHERE ${scopeWhere}
        AND ${termOr}
      ORDER BY (${matchSum}) DESC, su.unit_index ASC
      LIMIT ${CANON_RETRIEVAL.lexicalCandidateLimit}
    `);
    lexicalAnchors = lexicalRows.rows as unknown as AnchorRow[];
  }

  const lexicalIds = lexicalAnchors.map((r) => r.id);

  const lists = [vectorIds, lexicalIds].filter((l) => l.length > 0);
  if (lists.length === 0) return [];

  const fusedIds = reciprocalRankFusion(lists, CANON_RETRIEVAL.rrfK);

  const metaById = new Map<string, AnchorRow>();
  for (const r of vectorAnchors) {
    metaById.set(r.id, r);
  }
  for (const r of lexicalAnchors) {
    if (!metaById.has(r.id)) metaById.set(r.id, r);
  }

  const chosenAnchors: AnchorRow[] = [];
  for (const id of fusedIds) {
    const row = metaById.get(id);
    if (!row) continue;
    chosenAnchors.push(row);
    if (chosenAnchors.length >= anchorTopK) break;
  }

  if (chosenAnchors.length === 0) return [];

  const windows = mergeSceneWindows(chosenAnchors, CANON_RETRIEVAL.neighborWindow);
  const valueRows = windows.map(
    (w) => sql`(${w.sceneId}::uuid, ${w.lo}::int, ${w.hi}::int, ${w.blockIdx}::int)`,
  );

  const expanded = await db.execute(sql`
    SELECT
      su.id,
      su.text_content,
      su.content_type,
      su.speaker,
      su.canon_priority,
      su.unit_index,
      ra.arc_key,
      sc.chapter_key,
      sc.chapter_name,
      sc.chapter_label,
      se.episode_label,
      ss.id AS scene_id,
      ss.scene_order,
      ss.scene_title,
      cw.block_idx,
      CASE
        WHEN su.embedding IS NOT NULL THEN 1 - (su.embedding <=> ${embeddingStr}::vector)
        ELSE 0
      END AS cosine_similarity
    FROM story_units su
    JOIN (VALUES ${sql.join(valueRows, sql`, `)})
      AS cw(scene_id, lo, hi, block_idx)
      ON su.scene_id = cw.scene_id AND su.unit_index BETWEEN cw.lo AND cw.hi
    JOIN story_chapters sc ON su.chapter_id = sc.id
    JOIN relationship_arcs ra ON sc.relationship_arc_id = ra.id
    JOIN story_episodes se ON su.episode_id = se.id
    JOIN story_scenes ss ON su.scene_id = ss.id
    WHERE ${scopeWhere}
    ORDER BY
      cw.block_idx ASC,
      ra.arc_timeline_order NULLS LAST,
      sc.chapter_timeline_order NULLS LAST,
      se.episode_order ASC,
      ss.scene_order ASC,
      su.unit_index ASC
    LIMIT ${CANON_RETRIEVAL.maxUnitsAfterExpansion}
  `);

  return (expanded.rows as unknown as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    textContent: r.text_content as string,
    contentType: r.content_type as string,
    speaker: r.speaker as string | null,
    canonPriority: r.canon_priority as number | null,
    arcKey: r.arc_key as string,
    chapterKey: r.chapter_key as string,
    chapterName: r.chapter_name as string | null,
    chapterLabel: r.chapter_label as string | null,
    episodeLabel: r.episode_label as string | null,
    sceneId: r.scene_id as string,
    sceneOrder: r.scene_order as number | null,
    sceneTitle: r.scene_title as string | null,
    unitIndex: r.unit_index as number,
    blockIndex: r.block_idx as number,
    rankScore: r.cosine_similarity as number,
  }));
}

/** @deprecated Prefer {@link retrieveCanonNarrativeLegacy} in new code; name kept for imports. */
export const retrieveCanonNarrative = retrieveCanonNarrativeLegacy;

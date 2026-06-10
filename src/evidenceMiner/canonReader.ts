/**
 * Canon-read helper for the evidence miner.
 *
 * Reads story_units scoped by character and arc keys, returning chunks with
 * full provenance plus speaker and scene-local context (before/after ±1 unit,
 * same scene only, computed in JS from the ordered rows).
 *
 * Mirrors the join pattern in `src/retrieval/canon/searchUnitVectors.ts`
 * and `expandScenes.ts`.
 *
 * The chatbot NEVER writes canon tables — this is read-only.
 */
import { db } from "../db/client";
import { sql } from "drizzle-orm";
import type { CanonChunk, ContextUnit } from "./types";
import { DEFAULT_MAX_CHUNKS } from "./types";

/** Width of the context window (units before/after each chunk). */
export const CONTEXT_WINDOW = 2;

export interface ReadCanonInput {
  characterId: string;
  arcKeys: string[];
  /** Optional chapter_key filter (within the arc[s]) to scope down a run. */
  chapterKeys?: string[];
  limit?: number;
}

/**
 * Read story_units for a character scoped by arc keys.
 *
 * Each returned chunk includes speaker, unit text, full provenance (arcKey →
 * chapterKey → episodeLabel → sceneOrder → unitIndex → storySceneId), and
 * scene-local contextBefore/contextAfter arrays.
 */
export async function readCanonChunks(
  input: ReadCanonInput,
): Promise<CanonChunk[]> {
  const { characterId, arcKeys, chapterKeys, limit = DEFAULT_MAX_CHUNKS } =
    input;

  if (arcKeys.length === 0) return [];
  if (limit <= 0) return [];

  const arcKeysSql = sql.join(arcKeys.map((k) => sql`${k}`), sql`, `);

  const chapterFilter =
    chapterKeys && chapterKeys.length > 0
      ? sql`AND sc.chapter_key = ANY(ARRAY[${sql.join(
          chapterKeys.map((k) => sql`${k}`),
          sql`, `,
        )}]::text[])`
      : sql``;

  const rows = await db.execute(sql`
    SELECT
      su.text_content,
      su.speaker,
      su.unit_index,
      ss.id AS story_scene_id,
      ss.scene_order,
      se.episode_label,
      sc.chapter_key,
      ra.arc_key
    FROM story_units su
    JOIN story_scenes ss ON su.scene_id = ss.id
    JOIN story_chapters sc ON ss.chapter_id = sc.id
    JOIN relationship_arcs ra ON sc.relationship_arc_id = ra.id
    JOIN story_episodes se ON ss.episode_id = se.id
    WHERE su.character_id = ${characterId}
      AND ra.arc_key = ANY(ARRAY[${arcKeysSql}]::text[])
      ${chapterFilter}
    ORDER BY
      ra.arc_key,
      sc.chapter_key,
      se.episode_label,
      ss.scene_order,
      su.unit_index
    LIMIT ${limit}
  `);

  interface RawRow {
    text_content: string;
    speaker: string | null;
    unit_index: number;
    story_scene_id: string;
    scene_order: number;
    episode_label: string;
    chapter_key: string;
    arc_key: string;
  }

  const rawRows: RawRow[] = (rows.rows as Record<string, unknown>[]).map(
    (r) => ({
      text_content: r.text_content as string,
      speaker: (r.speaker as string | null) ?? null,
      unit_index: r.unit_index as number,
      story_scene_id: r.story_scene_id as string,
      scene_order: r.scene_order as number,
      episode_label: r.episode_label as string,
      chapter_key: r.chapter_key as string,
      arc_key: r.arc_key as string,
    }),
  );

  // Group by story_scene_id for context computation
  const sceneGroups = new Map<string, RawRow[]>();
  for (const r of rawRows) {
    const group = sceneGroups.get(r.story_scene_id) ?? [];
    group.push(r);
    sceneGroups.set(r.story_scene_id, group);
  }

  // Build a map of unit_index → position in scene group for O(1) neighbor lookup
  const scenePositionMap = new Map<string, Map<number, number>>();
  for (const [sceneId, units] of sceneGroups) {
    const posMap = new Map<number, number>();
    for (let i = 0; i < units.length; i++) {
      posMap.set(units[i]!.unit_index, i);
    }
    scenePositionMap.set(sceneId, posMap);
  }

  // Helper to get context units
  function getContext(row: RawRow, sceneId: string, offset: -1 | 1): ContextUnit[] {
    const units = sceneGroups.get(sceneId);
    const posMap = scenePositionMap.get(sceneId);
    if (!units || !posMap) return [];

    const idx = posMap.get(row.unit_index);
    if (idx === undefined) return [];

    const result: ContextUnit[] = [];
    for (let i = 1; i <= CONTEXT_WINDOW; i++) {
      const neighborIdx = idx + offset * i;
      if (neighborIdx < 0 || neighborIdx >= units.length) break;
      const neighbor = units[neighborIdx]!;
      result.push({
        text: neighbor.text_content,
        speaker: neighbor.speaker,
        unitIndex: neighbor.unit_index,
      });
    }
    return result;
  }

  return rawRows.map((r) => ({
    text: r.text_content,
    speaker: r.speaker,
    arcKey: r.arc_key,
    chapterKey: r.chapter_key,
    episodeLabel: r.episode_label,
    sceneOrder: r.scene_order,
    unitIndex: r.unit_index,
    storySceneId: r.story_scene_id,
    contextBefore: getContext(r, r.story_scene_id, -1),
    contextAfter: getContext(r, r.story_scene_id, 1),
  }));
}

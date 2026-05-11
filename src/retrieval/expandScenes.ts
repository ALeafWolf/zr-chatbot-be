import { db } from "../db/client";
import { sql } from "drizzle-orm";
import type { FusedAnchorScene } from "./fuseAnchors";

export interface ExpandedSceneRow {
  sceneId: string;
  chapterId: string;
  episodeId: string;
  arcKey: string;
  chapterName: string;
  episodeLabel: string;
  sceneTitle: string | null;
  sceneSummary: string | null;
  unitIndex: number;
  speaker: string | null;
  contentType: string;
  textContent: string;
}

export async function expandAnchorScenes(input: {
  characterId: string;
  arcKeys: string[];
  anchors: FusedAnchorScene[];
  maxUnitsPerScene: number;
  maxTotalUnits: number;
}): Promise<{
  rows: ExpandedSceneRow[];
  factsByScene: Map<
    string,
    Array<{
      subject: string;
      predicate: string;
      object: string;
      textForm: string;
    }>
  >;
}> {
  const { characterId, arcKeys, anchors, maxUnitsPerScene, maxTotalUnits } =
    input;
  if (anchors.length === 0 || arcKeys.length === 0) {
    return { rows: [], factsByScene: new Map() };
  }

  const sceneIds = anchors.map((a) => a.sceneId);
  const orderIdx = new Map(sceneIds.map((id, i) => [id, i]));
  const idList = sql.join(sceneIds.map((id) => sql`${id}::uuid`), sql`, `);
  const arcKeysSql = sql.join(arcKeys.map((k) => sql`${k}`), sql`, `);

  const unitRows = await db.execute(sql`
    SELECT
      ss.id AS scene_id,
      sc.id AS chapter_id,
      se.id AS episode_id,
      ra.arc_key,
      sc.chapter_name,
      se.episode_label,
      ss.scene_title,
      ss.scene_summary,
      su.unit_index,
      su.speaker,
      su.content_type,
      su.text_content
    FROM story_units su
    JOIN story_scenes ss ON su.scene_id = ss.id
    JOIN story_chapters sc ON ss.chapter_id = sc.id
    JOIN relationship_arcs ra ON sc.relationship_arc_id = ra.id
    JOIN story_episodes se ON ss.episode_id = se.id
    WHERE su.character_id = ${characterId}
      AND ra.arc_key = ANY(ARRAY[${arcKeysSql}]::text[])
      AND ss.id = ANY(ARRAY[${idList}]::uuid[])
  `);

  type R = ExpandedSceneRow;
  const all: R[] = (unitRows.rows as unknown as Record<string, unknown>[]).map(
    (r) => ({
      sceneId: r.scene_id as string,
      chapterId: r.chapter_id as string,
      episodeId: r.episode_id as string,
      arcKey: r.arc_key as string,
      chapterName: r.chapter_name as string,
      episodeLabel: r.episode_label as string,
      sceneTitle: r.scene_title as string | null,
      sceneSummary: r.scene_summary as string | null,
      unitIndex: r.unit_index as number,
      speaker: r.speaker as string | null,
      contentType: r.content_type as string,
      textContent: r.text_content as string,
    }),
  );

  all.sort((a, b) => {
    const oa = orderIdx.get(a.sceneId) ?? 9999;
    const ob = orderIdx.get(b.sceneId) ?? 9999;
    if (oa !== ob) return oa - ob;
    return a.unitIndex - b.unitIndex;
  });

  const perSceneUnitCount = new Map<string, number>();
  const rows: ExpandedSceneRow[] = [];
  let globalUsed = 0;

  for (const r of all) {
    const n = (perSceneUnitCount.get(r.sceneId) ?? 0) + 1;
    if (n > maxUnitsPerScene) continue;
    if (globalUsed >= maxTotalUnits) break;
    perSceneUnitCount.set(r.sceneId, n);
    globalUsed++;
    rows.push(r);
  }

  const factRows = await db.execute(sql`
    SELECT scene_id, subject, predicate, object, text_form
    FROM story_facts
    WHERE character_id = ${characterId}
      AND scene_id = ANY(ARRAY[${idList}]::uuid[])
    ORDER BY scene_id, temporal_index NULLS LAST, id
  `);

  const factsByScene = new Map<
    string,
    Array<{
      subject: string;
      predicate: string;
      object: string;
      textForm: string;
    }>
  >();

  for (const fr of factRows.rows as unknown as Record<string, unknown>[]) {
    const sid = fr.scene_id as string;
    const list = factsByScene.get(sid) ?? [];
    list.push({
      subject: String(fr.subject ?? ""),
      predicate: String(fr.predicate ?? ""),
      object: String(fr.object ?? ""),
      textForm: String(fr.text_form ?? ""),
    });
    factsByScene.set(sid, list);
  }

  return { rows, factsByScene };
}

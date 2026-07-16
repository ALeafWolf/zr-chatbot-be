import { db } from "../../db/client";
import { sql } from "drizzle-orm";
import type { FusedAnchorScene } from "./fuseAnchors";

/** How many raw opening units to fetch from Scene 1 for episode context. */
export const EPISODE_OPENING_MAX_UNITS = 3;

/** Maximum number of distinct episodes for which opening context is fetched. */
export const EPISODE_OPENING_MAX_EPISODES = 3;

export interface ExpandedSceneRow {
  sceneId: string;
  chapterId: string;
  episodeId: string;
  arcKey: string;
  chapterName: string;
  episodeLabel: string;
  episodeSummary: string | null;
  sceneTitle: string | null;
  sceneSummary: string | null;
  sceneOrder: number | null;
  unitIndex: number;
  speaker: string | null;
  contentType: string;
  textContent: string;
}

export interface EpisodeOpeningRow {
  episodeId: string;
  episodeSummary: string | null;
  episodeLabel: string;
  chapterName: string;
  units: Array<{
    unitIndex: number;
    speaker: string | null;
    contentType: string;
    textContent: string;
  }>;
}

export async function expandAnchorScenes(input: {
  characterId: string;
  arcKeys: string[];
  anchors: FusedAnchorScene[];
  maxUnitsPerScene: number;
  maxTotalUnits: number;
}): Promise<{
  rows: ExpandedSceneRow[];
  episodeOpeningUnits: EpisodeOpeningRow[];
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
    return { rows: [], episodeOpeningUnits: [], factsByScene: new Map() };
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
      se.summary AS episode_summary,
      ss.scene_title,
      ss.scene_summary,
      ss.scene_order,
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
      episodeSummary: r.episode_summary as string | null,
      sceneTitle: r.scene_title as string | null,
      sceneSummary: r.scene_summary as string | null,
      sceneOrder: r.scene_order as number | null,
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

  // Identify episodes where a later scene was retrieved but Scene 1 was not.
  // Use sceneOrder from expanded rows (may be null if schema lacks it).
  const episodeHasScene1 = new Set<string>();
  const episodeNeedsOpening = new Set<string>();
  for (const r of rows) {
    if (r.sceneOrder === 1) episodeHasScene1.add(r.episodeId);
  }
  for (const r of rows) {
    if (
      r.sceneOrder != null &&
      r.sceneOrder !== 1 &&
      !episodeHasScene1.has(r.episodeId)
    ) {
      episodeNeedsOpening.add(r.episodeId);
    }
  }

  let episodeOpeningUnits: EpisodeOpeningRow[] = [];
  if (episodeNeedsOpening.size > 0) {
    // Apply per-query episode cap to prevent opening too many distinct episodes
    const cappedEpList = [...episodeNeedsOpening].slice(0, EPISODE_OPENING_MAX_EPISODES);
    const epIdList = sql.join(
      cappedEpList.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const openingRows = await db.execute(sql`
      SELECT
        opened.season_episode_id AS episode_id,
        opened.season_episode_summary AS episode_summary,
        opened.season_episode_label AS episode_label,
        opened.season_chapter_name AS chapter_name,
        opened.unit_index,
        opened.speaker,
        opened.content_type,
        opened.text_content
      FROM (
        SELECT
          se.id AS season_episode_id,
          se.summary AS season_episode_summary,
          se.episode_label AS season_episode_label,
          sc.chapter_name AS season_chapter_name,
          su.unit_index,
          su.speaker,
          su.content_type,
          su.text_content,
          ROW_NUMBER() OVER (
            PARTITION BY se.id
            ORDER BY su.unit_index ASC
          ) AS rn
        FROM story_units su
        JOIN story_scenes ss ON su.scene_id = ss.id
        JOIN story_chapters sc ON ss.chapter_id = sc.id
        JOIN story_episodes se ON ss.episode_id = se.id
        JOIN relationship_arcs ra ON sc.relationship_arc_id = ra.id
        WHERE su.character_id = ${characterId}
          AND ra.arc_key = ANY(ARRAY[${arcKeysSql}]::text[])
          AND se.id = ANY(ARRAY[${epIdList}]::uuid[])
          AND ss.scene_order = 1
      ) opened
      WHERE opened.rn <= ${EPISODE_OPENING_MAX_UNITS}
      ORDER BY opened.season_episode_id, opened.unit_index
    `);

    const openingByEpisode = new Map<
      string,
      {
        episodeSummary: string | null;
        episodeLabel: string;
        chapterName: string;
        unitList: EpisodeOpeningRow["units"];
      }
    >();
    for (const or of openingRows.rows as unknown as Record<string, unknown>[]) {
      const epId = or.episode_id as string;
      let entry = openingByEpisode.get(epId);
      if (!entry) {
        entry = {
          episodeSummary: or.episode_summary as string | null,
          episodeLabel: or.episode_label as string,
          chapterName: or.chapter_name as string,
          unitList: [],
        };
        openingByEpisode.set(epId, entry);
      }
      entry.unitList.push({
        unitIndex: or.unit_index as number,
        speaker: or.speaker as string | null,
        contentType: or.content_type as string,
        textContent: or.text_content as string,
      });
    }

    episodeOpeningUnits = [...openingByEpisode.entries()].map(
      ([episodeId, entry]) => ({
        episodeId,
        episodeSummary: entry.episodeSummary,
        episodeLabel: entry.episodeLabel,
        chapterName: entry.chapterName,
        units: entry.unitList,
      }),
    );
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

  return { rows, episodeOpeningUnits, factsByScene };
}

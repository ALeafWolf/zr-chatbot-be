import { db } from "../db/client";
import { sql } from "drizzle-orm";

export interface SceneSummaryHit {
  sceneId: string;
  chapterId: string;
  episodeId: string;
  arcKey: string;
  chapterName: string;
  episodeLabel: string;
  sceneTitle: string | null;
  sceneSummary: string | null;
  similarity: number;
}

export async function searchSceneSummaries(input: {
  queryEmbedding: number[];
  characterId: string;
  arcKeys: string[];
  limit: number;
}): Promise<SceneSummaryHit[]> {
  const { queryEmbedding, characterId, arcKeys, limit } = input;
  if (arcKeys.length === 0) return [];

  const embeddingStr = `[${queryEmbedding.join(",")}]`;
  const arcKeysSql = sql.join(arcKeys.map((k) => sql`${k}`), sql`, `);

  const rows = await db.execute(sql`
    SELECT
      ss.id AS scene_id,
      sc.id AS chapter_id,
      se.id AS episode_id,
      ra.arc_key,
      sc.chapter_name,
      se.episode_label,
      ss.scene_title,
      ss.scene_summary,
      (1 - (ss.scene_summary_embedding <=> ${embeddingStr}::vector))::float AS similarity
    FROM story_scenes ss
    JOIN story_chapters sc ON ss.chapter_id = sc.id
    JOIN relationship_arcs ra ON sc.relationship_arc_id = ra.id
    JOIN story_episodes se ON ss.episode_id = se.id
    WHERE ss.character_id = ${characterId}
      AND ra.arc_key = ANY(ARRAY[${arcKeysSql}]::text[])
      AND ss.scene_summary_embedding IS NOT NULL
    ORDER BY ss.scene_summary_embedding <=> ${embeddingStr}::vector ASC
    LIMIT ${limit}
  `);

  return (rows.rows as unknown as Record<string, unknown>[]).map((r) => ({
    sceneId: r.scene_id as string,
    chapterId: r.chapter_id as string,
    episodeId: r.episode_id as string,
    arcKey: r.arc_key as string,
    chapterName: r.chapter_name as string,
    episodeLabel: r.episode_label as string,
    sceneTitle: r.scene_title as string | null,
    sceneSummary: r.scene_summary as string | null,
    similarity: Number(r.similarity),
  }));
}

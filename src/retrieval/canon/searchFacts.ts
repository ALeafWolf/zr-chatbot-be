import { db } from "../../db/client";
import { sql } from "drizzle-orm";
import { CANON_VECTOR_RANK_WEIGHTS } from "../../character/canonRules";

export interface FactHit {
  factId: string;
  sceneId: string;
  chapterId: string;
  episodeId: string;
  textForm: string;
  subject: string | null;
  predicate: string | null;
  object: string | null;
  similarity: number;
}

/**
 * Vector search over story_facts.embedding (no canon_priority on facts — similarity only).
 */
export async function searchFacts(input: {
  queryEmbedding: number[];
  characterId: string;
  arcKeys: string[];
  limit: number;
}): Promise<FactHit[]> {
  const { queryEmbedding, characterId, arcKeys, limit } = input;
  if (arcKeys.length === 0) return [];

  const embeddingStr = `[${queryEmbedding.join(",")}]`;
  const arcKeysSql = sql.join(arcKeys.map((k) => sql`${k}`), sql`, `);
  const wSim = CANON_VECTOR_RANK_WEIGHTS.similarity;

  const rows = await db.execute(sql`
    SELECT
      sf.id AS fact_id,
      sf.scene_id,
      sf.chapter_id,
      sf.episode_id,
      sf.text_form,
      sf.subject,
      sf.predicate,
      sf.object,
      ((1 - (sf.embedding <=> ${embeddingStr}::vector)) * ${wSim})::float AS similarity
    FROM story_facts sf
    JOIN story_chapters sc ON sf.chapter_id = sc.id
    JOIN relationship_arcs ra ON sc.relationship_arc_id = ra.id
    WHERE sf.character_id = ${characterId}
      AND ra.arc_key = ANY(ARRAY[${arcKeysSql}]::text[])
      AND sf.embedding IS NOT NULL
    ORDER BY sf.embedding <=> ${embeddingStr}::vector ASC
    LIMIT ${limit}
  `);

  return (rows.rows as unknown as Record<string, unknown>[]).map((r) => ({
    factId: r.fact_id as string,
    sceneId: r.scene_id as string,
    chapterId: r.chapter_id as string,
    episodeId: r.episode_id as string,
    textForm: r.text_form as string,
    subject: r.subject as string | null,
    predicate: r.predicate as string | null,
    object: r.object as string | null,
    similarity: Number(r.similarity),
  }));
}

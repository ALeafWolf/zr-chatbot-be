import { db } from "../db/client";
import { sql } from "drizzle-orm";
import { RETRIEVAL_LIMITS, RANKING_WEIGHTS } from "../character/canonRules";

export interface RetrievedCanonChunk {
  id: string;
  textContent: string;
  contentType: string;
  speaker: string | null;
  canonPriority: number | null;
  arcKey?: string;
  chapterKey?: string;
  rankScore: number;
}

/**
 * Retrieve the top-K most relevant canon story units for a turn.
 *
 * Scope filtering: only units from arcs whose arc_key is in arcKeys are surfaced.
 * Ranking: §8 weighted blend of similarity + canon_priority + scope/chapter match.
 * Out-of-scope content is never returned regardless of similarity score.
 */
export async function retrieveCanonNarrative(input: {
  queryEmbedding: number[];
  characterId: string;
  arcKeys: string[];           // resolved from resolveContinuityScope
  limit?: number;
}): Promise<RetrievedCanonChunk[]> {
  const { queryEmbedding, characterId, arcKeys, limit = RETRIEVAL_LIMITS.canonChunks } = input;

  if (arcKeys.length === 0) return [];

  const embeddingStr = `[${queryEmbedding.join(",")}]`;
  const { similarity, canonPriority, continuityScopeMatch } = RANKING_WEIGHTS;

  const rows = await db.execute(sql`
    SELECT
      su.id,
      su.text_content,
      su.content_type,
      su.speaker,
      su.canon_priority,
      ra.arc_key,
      sc.chapter_key,
      1 - (su.embedding <=> ${embeddingStr}::vector) AS cosine_similarity,
      (
        (1 - (su.embedding <=> ${embeddingStr}::vector)) * ${similarity}
        + COALESCE(su.canon_priority, 0.5) * ${canonPriority}
        + ${continuityScopeMatch}
      ) AS rank_score
    FROM story_units su
    JOIN story_chapters sc ON su.chapter_id = sc.id
    JOIN relationship_arcs ra ON sc.relationship_arc_id = ra.id
    WHERE su.character_id = ${characterId}
      AND ra.arc_key = ANY(ARRAY[${sql.join(arcKeys.map((k) => sql`${k}`), sql`, `)}]::text[])
      AND su.embedding IS NOT NULL
    ORDER BY rank_score DESC
    LIMIT ${limit}
  `);

  return rows.rows.map((r) => ({
    id: r.id as string,
    textContent: r.text_content as string,
    contentType: r.content_type as string,
    speaker: r.speaker as string | null,
    canonPriority: r.canon_priority as number | null,
    arcKey: r.arc_key as string,
    chapterKey: r.chapter_key as string,
    rankScore: r.rank_score as number,
  }));
}

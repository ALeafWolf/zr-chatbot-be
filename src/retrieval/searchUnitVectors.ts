import { db } from "../db/client";
import { sql } from "drizzle-orm";
import {
  CANON_RETRIEVAL,
  CANON_VECTOR_RANK_WEIGHTS,
} from "../character/canonRules";

export interface UnitVectorHit {
  unitId: string;
  sceneId: string;
  unitIndex: number;
  similarity: number;
}

export async function searchUnitVectors(input: {
  queryEmbedding: number[];
  characterId: string;
  arcKeys: string[];
  limit: number;
}): Promise<UnitVectorHit[]> {
  const { queryEmbedding, characterId, arcKeys, limit } = input;
  if (arcKeys.length === 0) return [];

  const embeddingStr = `[${queryEmbedding.join(",")}]`;
  const arcKeysSql = sql.join(arcKeys.map((k) => sql`${k}`), sql`, `);
  const { similarity: wSim, canonPriority: wPri } = CANON_VECTOR_RANK_WEIGHTS;

  const rows = await db.execute(sql`
    SELECT
      su.id AS unit_id,
      su.scene_id,
      su.unit_index,
      (
        (1 - (su.embedding <=> ${embeddingStr}::vector)) * ${wSim}
        + COALESCE(su.canon_priority, 0.5) * ${wPri}
      )::float AS similarity
    FROM story_units su
    JOIN story_chapters sc ON su.chapter_id = sc.id
    JOIN relationship_arcs ra ON sc.relationship_arc_id = ra.id
    WHERE su.character_id = ${characterId}
      AND ra.arc_key = ANY(ARRAY[${arcKeysSql}]::text[])
      AND su.embedding IS NOT NULL
    ORDER BY
      (
        (1 - (su.embedding <=> ${embeddingStr}::vector)) * ${wSim}
        + COALESCE(su.canon_priority, 0.5) * ${wPri}
      ) DESC
    LIMIT ${limit}
  `);

  return (rows.rows as unknown as Record<string, unknown>[]).map((r) => ({
    unitId: r.unit_id as string,
    sceneId: r.scene_id as string,
    unitIndex: r.unit_index as number,
    similarity: Number(r.similarity),
  }));
}

/** Dedupe preserving first (best) rank per scene. */
export function sceneIdsFromUnitHits(hits: UnitVectorHit[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hits) {
    if (seen.has(h.sceneId)) continue;
    seen.add(h.sceneId);
    out.push(h.sceneId);
  }
  return out;
}

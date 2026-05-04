import { db } from "../db/client";
import { interactiveMemoryEvents } from "../db/schema/memory";
import { eq, sql } from "drizzle-orm";
import type { MemoryNamespace } from "../memory/memoryNamespace";
import { RETRIEVAL_LIMITS } from "../character/canonRules";

export interface RetrievedMemory {
  id: string;
  memoryType: string;
  summary: string;
  importanceScore: number;
  emotionScore: number;
  reuseCount: number;
  cosineSimilarity: number;
}

/**
 * Retrieve the top-K most relevant interactive memories for a turn.
 *
 * Applies pgvector cosine distance search filtered strictly to the active
 * memory namespace. No out-of-namespace content is ever surfaced.
 *
 * Updates last_accessed_at and reuse_count on retrieved rows (on-read freshness).
 */
export async function retrieveInteractiveMemories(input: {
  queryEmbedding: number[];
  memoryNamespace: MemoryNamespace;
  characterId: string;
  limit?: number;
}): Promise<RetrievedMemory[]> {
  const { queryEmbedding, memoryNamespace, characterId, limit = RETRIEVAL_LIMITS.memories } = input;
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const rows = await db.execute(sql`
    SELECT
      id,
      memory_type,
      summary,
      importance_score,
      emotion_score,
      reuse_count,
      1 - (embedding <=> ${embeddingStr}::vector) AS cosine_similarity
    FROM interactive_memory_events
    WHERE memory_namespace = ${memoryNamespace}
      AND character_id = ${characterId}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT ${limit}
  `);

  if (rows.rows.length === 0) return [];

  const ids = rows.rows.map((r) => r.id as string);

  // Update access metadata for retrieved rows (non-blocking best-effort)
  void db
    .update(interactiveMemoryEvents)
    .set({
      lastAccessedAt: new Date(),
      reuseCount: sql`reuse_count + 1`,
    })
    .where(sql`id = ANY(ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::text[])`);

  return rows.rows.map((r) => ({
    id: r.id as string,
    memoryType: r.memory_type as string,
    summary: r.summary as string,
    importanceScore: r.importance_score as number,
    emotionScore: r.emotion_score as number,
    reuseCount: r.reuse_count as number,
    cosineSimilarity: r.cosine_similarity as number,
  }));
}

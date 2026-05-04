import { db } from "../db/client";
import { interactiveMemoryEvents } from "../db/schema/memory";
import { eq, and, sql } from "drizzle-orm";
import type { MemoryNamespace } from "./memoryNamespace";

const DEDUP_COSINE_THRESHOLD = 0.12; // cosine distance < 0.12 ≈ similarity > 0.88

/**
 * Check for a semantically near-identical memory in the same namespace.
 * If found, update recency/reuse metadata and return true (caller skips insert).
 * If not found, return false (caller should insert).
 */
export async function deduplicateMemory(input: {
  embedding: number[];
  namespace: MemoryNamespace;
  characterId: string;
}): Promise<boolean> {
  const { embedding, namespace, characterId } = input;
  const embeddingStr = `[${embedding.join(",")}]`;

  const rows = await db.execute(sql`
    SELECT id
    FROM interactive_memory_events
    WHERE memory_namespace = ${namespace}
      AND character_id = ${characterId}
      AND embedding IS NOT NULL
      AND embedding <=> ${embeddingStr}::vector < ${DEDUP_COSINE_THRESHOLD}
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT 1
  `);

  if (rows.rows.length === 0) {
    return false;
  }

  const existingId = rows.rows[0].id as string;
  await db
    .update(interactiveMemoryEvents)
    .set({
      recencyScore: 1.0,
      lastAccessedAt: new Date(),
      reuseCount: sql`reuse_count + 1`,
    })
    .where(eq(interactiveMemoryEvents.id, existingId));

  return true;
}

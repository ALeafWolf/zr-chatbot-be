import { db } from "../../db/client";
import { interactiveMemoryEvents } from "../../db/schema/memory";
import { eq, sql } from "drizzle-orm";
import type { MemoryNamespace } from "../shared/memoryNamespace";
import {
  runMemoryDedupJudge,
  type MemoryDedupJudgeResult,
} from "../../llm/validation/runMemoryDedupJudge";

const DEDUP_COSINE_THRESHOLD = 0.12;
const AMBIGUOUS_COSINE_DISTANCE_MAX = 0.2;

export interface MemoryDedupCandidate {
  id: string;
  summary: string;
  cosineDistance: number;
}

export type MemoryDedupDecision =
  | { kind: "deduplicate"; existingId: string; usedJudge: boolean }
  | { kind: "insert"; usedJudge: boolean };

export async function decideMemoryDedupAction(input: {
  newMemorySummary: string;
  candidates: MemoryDedupCandidate[];
  judge: (input: {
    newMemorySummary: string;
    candidates: Array<{ id: string; summary: string }>;
  }) => Promise<MemoryDedupJudgeResult>;
}): Promise<MemoryDedupDecision> {
  const candidates = [...input.candidates].sort(
    (a, b) => a.cosineDistance - b.cosineDistance,
  );
  const nearest = candidates[0];
  if (!nearest) return { kind: "insert", usedJudge: false };

  if (nearest.cosineDistance < DEDUP_COSINE_THRESHOLD) {
    return {
      kind: "deduplicate",
      existingId: nearest.id,
      usedJudge: false,
    };
  }

  const ambiguous = candidates.filter(
    (candidate) =>
      candidate.cosineDistance < AMBIGUOUS_COSINE_DISTANCE_MAX,
  );
  if (ambiguous.length === 0) return { kind: "insert", usedJudge: false };

  const verdict = await input.judge({
    newMemorySummary: input.newMemorySummary,
    candidates: ambiguous
      .slice(0, 3)
      .map((candidate) => ({ id: candidate.id, summary: candidate.summary })),
  });

  if (
    verdict.decision === "same" ||
    verdict.decision === "superseding_update"
  ) {
    const matchingCandidate = verdict.matchingCandidateId
      ? ambiguous.find((candidate) => candidate.id === verdict.matchingCandidateId)
      : undefined;
    return {
      kind: "deduplicate",
      existingId: matchingCandidate?.id ?? ambiguous[0]!.id,
      usedJudge: true,
    };
  }

  return { kind: "insert", usedJudge: true };
}

/**
 * Check for a semantically near-identical memory in the same namespace.
 * If found, update recency/reuse metadata and return true (caller skips insert).
 * If not found, return false (caller should insert).
 */
export async function deduplicateMemory(input: {
  embedding: number[];
  summary: string;
  namespace: MemoryNamespace;
  characterId: string;
}): Promise<boolean> {
  const { embedding, namespace, characterId } = input;
  const embeddingStr = `[${embedding.join(",")}]`;

  const rows = await db.execute(sql`
    SELECT
      id,
      summary,
      embedding <=> ${embeddingStr}::vector AS cosine_distance
    FROM interactive_memory_events
    WHERE memory_namespace = ${namespace}
      AND character_id = ${characterId}
      AND status = 'active'
      AND embedding IS NOT NULL
      AND embedding <=> ${embeddingStr}::vector < ${AMBIGUOUS_COSINE_DISTANCE_MAX}
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT 3
  `);

  const decision = await decideMemoryDedupAction({
    newMemorySummary: input.summary,
    candidates: rows.rows.map((row) => ({
      id: row.id as string,
      summary: row.summary as string,
      cosineDistance: row.cosine_distance as number,
    })),
    judge: runMemoryDedupJudge,
  });

  if (decision.kind === "insert") {
    return false;
  }

  await db
    .update(interactiveMemoryEvents)
    .set({
      recencyScore: 1.0,
      lastAccessedAt: new Date(),
      reuseCount: sql`reuse_count + 1`,
    })
    .where(eq(interactiveMemoryEvents.id, decision.existingId));

  return true;
}

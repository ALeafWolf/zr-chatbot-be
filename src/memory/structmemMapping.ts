import type {
  MemoryCandidate,
  ExtractorSessionChunkType,
} from "./writeInteractiveMemory";

/** All StructMem entry_type values allowed by the DB check (Phase 2 doc §7). */
export type StructMemEntryType =
  | "factual"
  | "relational"
  | ExtractorSessionChunkType;

/** Phase 1: only session-chunk labels came from the legacy extractor mapping. */
export type StructMemEntryTypePhase1 = ExtractorSessionChunkType;

/**
 * One row ready for `structmem_entries` insert (Phase 1 mapped or Phase 2 native).
 */
export type StructMemPersistRow = {
  entryType: StructMemEntryType;
  text: string;
  embedding: number[];
  importanceScore: number;
  /** When null, `writeStructMemTurn` uses batch extractor confidence. */
  confidenceScore: number | null;
  metadata?: Record<string, unknown>;
};

/**
 * Maps a post-turn memory candidate to a StructMem entry type.
 * Only current_session candidates with a valid session chunk type participate;
 * cross_session candidates use interactive_memory_events only.
 * Omitted scope is treated as current-session by the post-turn normalizer.
 */
export function mapMemoryCandidateToStructMemEntryType(
  candidate: Pick<MemoryCandidate, "memoryScope" | "sessionChunkType">,
): StructMemEntryTypePhase1 | null {
  if ((candidate.memoryScope ?? "current_session") !== "current_session") {
    return null;
  }
  const t = (candidate.sessionChunkType ?? "scene_moment") as string;
  if (
    t === "scene_moment" ||
    t === "decision" ||
    t === "emotional_shift" ||
    t === "open_thread"
  ) {
    return t;
  }
  return null;
}

/**
 * Phase 1 path: derive StructMem persist rows from `memory_candidates` only.
 */
export function collectPhase1StructMemPersistRows(
  memoryFacts: MemoryCandidate[],
): StructMemPersistRow[] {
  const out: StructMemPersistRow[] = [];
  for (const candidate of memoryFacts) {
    const entryType = mapMemoryCandidateToStructMemEntryType(candidate);
    if (!entryType) continue;
    const text = candidate.summary?.trim();
    if (!text) continue;
    out.push({
      entryType,
      text,
      embedding: candidate.embedding,
      importanceScore: candidate.importanceScore,
      confidenceScore: null,
      metadata: { memoryType: candidate.memoryType },
    });
  }
  return out;
}

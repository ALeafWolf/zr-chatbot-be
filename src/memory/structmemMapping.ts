import type {
  MemoryCandidate,
  ExtractorSessionChunkType,
} from "./writeInteractiveMemory";

/** Phase 1 entry types written from the existing extractor. */
export type StructMemEntryTypePhase1 = ExtractorSessionChunkType;

/**
 * Maps a post-turn memory candidate to a StructMem entry type.
 * Only current_session candidates with a valid session chunk type participate;
 * cross_session candidates use interactive_memory_events only.
 */
export function mapMemoryCandidateToStructMemEntryType(
  candidate: Pick<MemoryCandidate, "memoryScope" | "sessionChunkType">,
): StructMemEntryTypePhase1 | null {
  if ((candidate.memoryScope ?? "cross_session") !== "current_session") {
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

export function collectMappedStructMemCandidates(
  memoryFacts: MemoryCandidate[],
): Array<{ candidate: MemoryCandidate; entryType: StructMemEntryTypePhase1 }> {
  const out: Array<{
    candidate: MemoryCandidate;
    entryType: StructMemEntryTypePhase1;
  }> = [];
  for (const candidate of memoryFacts) {
    const entryType = mapMemoryCandidateToStructMemEntryType(candidate);
    if (entryType) {
      out.push({ candidate, entryType });
    }
  }
  return out;
}

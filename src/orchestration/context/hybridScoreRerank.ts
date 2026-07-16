/**
 * Hybrid score-based memory rerank selector.
 *
 * Non-LLM selector that uses candidate score, source priority, planner intent,
 * and existing caps to select context candidates without calling a model.
 *
 * Designed for RERANK_VARIANT=hybrid_score.
 */
import {
  applyCandidateSelection,
  filterCanonBySelection,
  type ContextCandidate,
  type ContextCandidateSource,
} from "./contextCandidates";
import type { RerankContextInput } from "./rerankContext";
import type { MemoryRerankOutput } from "../retrieval/memoryRerank";
import type { PromptMemoryContextSelection } from "./promptMemoryContextSelector";
import type { RetrievedCanonChunk } from "../../retrieval/canon/retrieveCanonNarrative";
import type { RetrievedCanonScene } from "../../retrieval/canon/retrieveCanonTier3Pipeline";
import type { SessionSummaryRecord } from "../../memory/session/sessionSummaryRepo";
import type { LatestTurnDelta } from "../turn/turnDelta";
import type { MemoryCorrectionContext } from "./memoryCorrections";

// ---------------------------------------------------------------------------
// Source priority for hybrid selection (lower number = higher priority)
// ---------------------------------------------------------------------------

const HYBRID_SOURCE_PRIORITY: Record<ContextCandidateSource, number> = {
  memory_correction: 0,
  open_thread: 1,
  latest_turn_delta: 2,
  session_summary: 3,
  structmem_entry: 4,
  structmem_consolidation: 5,
  motif_probe: 6,
  session_chunk: 7,
  interactive_memory: 8,
  internal_logic_evidence: 8,
  canon_fact: 8,
  canon_chunk: 9,
};

// Per-source max-selected caps (conservative — fewer selections when not using LLM)
const HYBRID_SOURCE_CAPS: Partial<Record<ContextCandidateSource, number>> = {
  memory_correction: 3,
  open_thread: 2,
  structmem_entry: 3,
  structmem_consolidation: 2,
  session_chunk: 3,
  interactive_memory: 3,
  internal_logic_evidence: 2,
  canon_fact: 3,
  canon_chunk: 2,
};

const HYBRID_TOTAL_CAP = 12;

// ---------------------------------------------------------------------------
// Intent-specific adjustments
// ---------------------------------------------------------------------------

/** Sources that are always selected for a given planner intent (when present in candidates). */
const INTENT_REQUIRED_SOURCES: Record<
  string,
  ContextCandidateSource[]
> = {
  explicit_recall: ["interactive_memory", "session_chunk", "structmem_entry"],
  implicit_memory_callback: ["interactive_memory", "session_chunk"],
  canon_question: ["canon_fact", "canon_chunk"],
  scene_continuation: [],
  relationship_state: ["interactive_memory", "structmem_consolidation"],
  mixed: [],
  unclear: [],
};

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

export interface HybridScoreRerankOutput {
  rerankOutput: MemoryRerankOutput;
  selectedContext: PromptMemoryContextSelection;
  canonChunks: RetrievedCanonChunk[];
  canonScenes: RetrievedCanonScene[];
  filteredSessionSummary: SessionSummaryRecord;
  filteredLatestTurnDelta: LatestTurnDelta | null;
  filteredMemoryCorrections: MemoryCorrectionContext[];
  /** Time spent in hybrid selection (fast, no LLM). */
  hybridMs: number;
  /** Diagnostic label for traces. */
  variantLabel: "hybrid_score";
  /** Reason for the selection method. */
  selectionMethod: "score_priority_hybrid";
}

// ---------------------------------------------------------------------------
// Hybrid score selection
// ---------------------------------------------------------------------------

/**
 * Select context candidates using score + source priority + planner intent.
 *
 * Strategy:
 * 1. Required sources for the given intent are included first (up to cap).
 * 2. Remaining slots are filled by (source priority, score) ranking.
 * 3. Total selections are capped conservatively.
 */
export function hybridScoreSelect(
  candidates: ContextCandidate[],
  plannerIntent: string,
): { selected: ContextCandidate[] } {
  const requiredSources = INTENT_REQUIRED_SOURCES[plannerIntent] ?? [];

  // Score each candidate and determine priority
  const scored = candidates.map((c) => ({
    candidate: c,
    priority: HYBRID_SOURCE_PRIORITY[c.source] ?? 99,
  }));

  // Sort by: required first (by source), then by priority, then by score descending
  const sorted = scored.sort((a, b) => {
    const aRequired = requiredSources.includes(a.candidate.source);
    const bRequired = requiredSources.includes(b.candidate.source);
    if (aRequired !== bRequired) return aRequired ? -1 : 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return (b.candidate.score ?? 0) - (a.candidate.score ?? 0);
  });

  const selected: ContextCandidate[] = [];
  const countsBySource: Partial<Record<string, number>> = {};

  for (const { candidate } of sorted) {
    const source = candidate.source;
    const cap = HYBRID_SOURCE_CAPS[source] ?? 1;
    const current = countsBySource[source] ?? 0;
    if (current >= cap) continue;
    if (selected.length >= HYBRID_TOTAL_CAP) break;
    selected.push(candidate);
    countsBySource[source] = current + 1;
  }

  return { selected };
}

// ---------------------------------------------------------------------------
// Main hybrid rerank function (matches RerankContextOutput shape)
// ---------------------------------------------------------------------------

/**
 * Run hybrid score-based rerank.
 *
 * This is used as a graph node seam for RERANK_VARIANT=hybrid_score.
 * It produces a `RerankContextOutput`-compatible result without calling an LLM.
 */
export async function runHybridScoreRerank(
  input: RerankContextInput,
): Promise<HybridScoreRerankOutput> {
  const startedAt = Date.now();

  const { selected } = hybridScoreSelect(
    input.candidates,
    input.plannerIntent,
  );

  const selectedIds = selected.map((c) => c.id);

  // Apply candidate selection (convert back to typed arrays)
  const applied = applyCandidateSelection({
    shortlist: input.candidates,
    selectedIds,
    memories: input.memories,
    sessionRecall: input.sessionRecall,
    structMemEntries: input.structMemEntries,
    structMemConsolidations: input.structMemConsolidations,
    openThreads: input.openThreads,
    internalLogicEvidence: input.internalLogicEvidence,
  });

  const selectedContext: PromptMemoryContextSelection = {
    memories: applied.memories,
    sessionRecall: applied.sessionRecall,
    structMemEntries: applied.structMemEntries,
    structMemConsolidations: applied.structMemConsolidations,
    openThreads: applied.openThreads,
    internalLogicEvidence: applied.internalLogicEvidence,
    diagnostics: {
      retrievedCounts: {
        interactive_memory: input.memories.length,
        session_chunk: input.sessionRecall.length,
        structmem_entry: input.structMemEntries.length,
        structmem_consolidation: input.structMemConsolidations.length,
        open_thread: input.openThreads.length,
        internal_logic_evidence: input.internalLogicEvidence?.length ?? 0,
      } as any,
      injectedCounts: {
        interactive_memory: applied.memories.length,
        session_chunk: applied.sessionRecall.length,
        structmem_entry: applied.structMemEntries.length,
        structmem_consolidation: applied.structMemConsolidations.length,
        open_thread: applied.openThreads.length,
        internal_logic_evidence: applied.internalLogicEvidence.length,
      } as any,
      droppedDuplicateCount: 0,
      droppedLowScoreCount: 0,
      droppedCorrectionCount: 0,
      droppedBudgetCount: 0,
      topSources: [],
      averageInjectedScore: null,
    },
  };

  // Build outputs required by HybridScoreRerankOutput type
  const selectedCanonChunkIds = selected
    .filter((c) => c.source === "canon_chunk")
    .map((c) => c.id);
  const selectedCanonFactIds = selected
    .filter((c) => c.source === "canon_fact")
    .map((c) => c.id);
  const filteredCanon = filterCanonBySelection(
    input.canonChunks,
    input.canonScenes,
    selectedCanonChunkIds,
    selectedCanonFactIds,
  );

  const hasCanon = selectedCanonChunkIds.length > 0 || selectedCanonFactIds.length > 0;
  const hasMemory =
    applied.memories.length > 0 ||
    applied.sessionRecall.length > 0 ||
    applied.structMemEntries.length > 0 ||
    applied.structMemConsolidations.length > 0 ||
    applied.openThreads.length > 0 ||
    applied.internalLogicEvidence.length > 0;
  const finalContextMode: "recent_only" | "selected_memory" | "selected_canon" | "memory_and_canon" | "no_extra_context" =
    hasCanon && hasMemory ? "memory_and_canon" :
    hasCanon ? "selected_canon" :
    hasMemory ? "selected_memory" :
    "recent_only";

  return {
    rerankOutput: {
      selected: selected.map((c) => ({
        id: c.id,
        source: c.source,
        relevance: "useful" as const,
        usageInstruction: "use_subtly" as const,
        reasonCode: "direct_continuity" as const,
      })),
      rejected: [],
      finalContextMode,
      needsEvidenceFallback: false,
    },
    selectedContext,
    canonChunks: filteredCanon.canonChunks,
    canonScenes: filteredCanon.canonScenes,
    filteredSessionSummary: input.sessionSummary,
    filteredLatestTurnDelta: input.latestTurnDelta,
    filteredMemoryCorrections: input.memoryCorrections,
    hybridMs: Date.now() - startedAt,
    variantLabel: "hybrid_score",
    selectionMethod: "score_priority_hybrid",
  };
}

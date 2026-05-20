import type { PromptMemorySelectionDiagnostics } from "../context/promptMemoryContextSelector";
import type { RetrievalPlan } from "./retrievalPlan";
import type { StructMemEntryExpansionDiagnostics } from "../../retrieval/memory/retrieveStructMemEntryContextExpansions";

export interface RetrievalDiagnosticsPayloadInput {
  retrievalPlan: RetrievalPlan;
  memoryQueryMode: "single" | "fused";
  rewriteConfidence: number | null;
  annotationFallback: boolean;
  boundaryOverlapTurns: number;
  olderRecallExclusiveFirstTurn: number;
  latestTurnDeltaActive: boolean;
  timingsMs?: RetrievalTimingDiagnostics;
  structMemEntryExpansion?: StructMemEntryExpansionDiagnostics;
  selectionDiagnostics: PromptMemorySelectionDiagnostics;
  rerank?: {
    selectedCount?: number;
    rejectedCount?: number;
    finalContextMode?: string;
    needsEvidenceFallback?: boolean;
    fallbackUsed?: boolean;
    fallbackReason?: string;
    /** How candidate IDs from the raw reranker output were resolved. */
    resolution?: {
      exactIdCount: number;
      numericIndexCount: number;
      unresolvedCount: number;
    };
  };
}

export interface RetrievalTimingDiagnostics {
  queryRewriteMs: number;
  embeddingsMs: number;
  mainRetrievalMs: number;
  olderRecallMs: number;
  openThreadsMs: number;
  selectorMs: number;
  totalResolveContextMs: number;
  /** Time to build the candidate shortlist (subset of selectorMs). */
  shortlistMs?: number;
  /** Time for the rerank LLM call + processing (subset of selectorMs). */
  rerankMs?: number;
  /** Time for the deterministic fallback selector when rerank fails (subset of selectorMs). */
  selectorFallbackMs?: number;
}

export function buildRetrievalDiagnosticsPayload(
  input: RetrievalDiagnosticsPayloadInput,
): Record<string, unknown> {
  return {
    queryIntent: input.retrievalPlan.intent,
    retrievalPlan: {
      broadFailOpen: input.retrievalPlan.broadFailOpen,
      canonMode: input.retrievalPlan.canonMode,
      forceOpenThreads: input.retrievalPlan.forceOpenThreads,
      durableMemoryTopK: input.retrievalPlan.durableMemoryTopK,
      sessionRecallTopK: input.retrievalPlan.sessionRecallTopK,
      structMemEntryTopK: input.retrievalPlan.structMemEntryTopK,
      structMemConsolidationTopK:
        input.retrievalPlan.structMemConsolidationTopK,
      openThreadTopK: input.retrievalPlan.openThreadTopK,
    },
    memoryQueryMode: input.memoryQueryMode,
    rewriteConfidence: input.rewriteConfidence,
    annotationFallback: input.annotationFallback,
    boundaryOverlapTurns: input.boundaryOverlapTurns,
    olderRecallExclusiveFirstTurn: input.olderRecallExclusiveFirstTurn,
    latestTurnDeltaActive: input.latestTurnDeltaActive,
    openThreadCount: input.selectionDiagnostics.injectedCounts.open_thread,
    retrievedCounts: input.selectionDiagnostics.retrievedCounts,
    injectedCounts: input.selectionDiagnostics.injectedCounts,
    droppedDuplicateCount: input.selectionDiagnostics.droppedDuplicateCount,
    droppedLowScoreCount: input.selectionDiagnostics.droppedLowScoreCount,
    droppedCorrectionCount: input.selectionDiagnostics.droppedCorrectionCount,
    droppedBudgetCount: input.selectionDiagnostics.droppedBudgetCount,
    topSources: input.selectionDiagnostics.topSources,
    averageInjectedScore: input.selectionDiagnostics.averageInjectedScore,
    timingsMs: input.timingsMs ?? null,
    structMemEntryExpansion: input.structMemEntryExpansion ?? null,
    rerank: input.rerank ?? null,
  };
}

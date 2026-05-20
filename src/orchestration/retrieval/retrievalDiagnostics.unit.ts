import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRetrievalDiagnosticsPayload } from "./retrievalDiagnostics";
import type { RetrievalPlan } from "./retrievalPlan";
import type { PromptMemorySelectionDiagnostics } from "../context/promptMemoryContextSelector";

const retrievalPlan: RetrievalPlan = {
  intent: "personal_recall",
  broadFailOpen: false,
  canonMode: "compact",
  forceOpenThreads: true,
  durableMemoryTopK: 7,
  sessionRecallTopK: 6,
  structMemEntryTopK: 8,
  structMemConsolidationTopK: 4,
  openThreadTopK: 7,
  contextNeed: {
    needsRecentTurns: true,
    needsOlderSessionRecall: true,
    needsDurableMemory: true,
    needsStructMem: true,
    needsStructMemConsolidation: false,
    needsCanon: false,
    needsWeb: false,
    injectionMode: "full",
    reason: "unit_test_fixture",
  },
};

const diagnostics: PromptMemorySelectionDiagnostics = {
  retrievedCounts: {
    session_chunk: 2,
    structmem_entry: 3,
    structmem_consolidation: 1,
    interactive_memory: 2,
    open_thread: 1,
  },
  injectedCounts: {
    session_chunk: 1,
    structmem_entry: 2,
    structmem_consolidation: 0,
    interactive_memory: 1,
    open_thread: 1,
  },
  droppedDuplicateCount: 2,
  droppedLowScoreCount: 1,
  droppedCorrectionCount: 1,
  droppedBudgetCount: 1,
  topSources: ["open_thread", "structmem_entry"],
  averageInjectedScore: 0.71,
};

describe("buildRetrievalDiagnosticsPayload", () => {
  it("includes planner, selector, overlap, and delta fields for LangSmith", () => {
    const payload = buildRetrievalDiagnosticsPayload({
      retrievalPlan,
      memoryQueryMode: "fused",
      rewriteConfidence: 0.82,
      annotationFallback: false,
      boundaryOverlapTurns: 2,
      olderRecallExclusiveFirstTurn: 14,
      latestTurnDeltaActive: true,
      timingsMs: {
        queryRewriteMs: 11,
        embeddingsMs: 22,
        mainRetrievalMs: 33,
        olderRecallMs: 44,
        openThreadsMs: 55,
        selectorMs: 66,
        totalResolveContextMs: 77,
      },
      structMemEntryExpansion: {
        eligibleCount: 4,
        expandedCount: 3,
        droppedByBudgetCount: 1,
      },
      selectionDiagnostics: diagnostics,
    });

    assert.equal(payload.queryIntent, "personal_recall");
    assert.equal(payload.memoryQueryMode, "fused");
    assert.equal(payload.rewriteConfidence, 0.82);
    assert.equal(payload.openThreadCount, 1);
    assert.equal(payload.droppedDuplicateCount, 2);
    assert.equal(payload.droppedCorrectionCount, 1);
    const t = payload.timingsMs as Record<string, number> | null;
    assert.notEqual(t, null);
    assert.equal(t!.queryRewriteMs, 11);
    assert.equal(t!.embeddingsMs, 22);
    assert.equal(t!.mainRetrievalMs, 33);
    assert.equal(t!.olderRecallMs, 44);
    assert.equal(t!.openThreadsMs, 55);
    assert.equal(t!.selectorMs, 66);
    assert.equal(t!.totalResolveContextMs, 77);
    // selectorFallbackMs is omitted when fallback was not used, verify absence
    assert.equal((t as Record<string, unknown>).selectorFallbackMs, undefined);
    assert.deepEqual(payload.structMemEntryExpansion, {
      eligibleCount: 4,
      expandedCount: 3,
      droppedByBudgetCount: 1,
    });
    assert.deepEqual(payload.topSources, ["open_thread", "structmem_entry"]);
    assert.deepEqual(
      payload.retrievalPlan,
      {
        broadFailOpen: false,
        canonMode: "compact",
        forceOpenThreads: true,
        durableMemoryTopK: 7,
        sessionRecallTopK: 6,
        structMemEntryTopK: 8,
        structMemConsolidationTopK: 4,
        openThreadTopK: 7,
      },
    );
  });
});

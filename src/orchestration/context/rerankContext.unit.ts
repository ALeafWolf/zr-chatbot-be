import { describe, it } from "node:test";
import assert from "node:assert";
import { rerankContext, type RerankContextInput } from "./rerankContext";
import type { MemoryRerankResult, MemoryRerankSelected, MemoryRerankOutput } from "../retrieval/memoryRerank";
import type { PromptMemoryContextSelection } from "./promptMemoryContextSelector";
import type { ConversationTurn } from "../../retrieval/conversation/getRecentConversationWindow";
import type { RetrievedMemory } from "../../retrieval/memory/retrieveInteractiveMemories";
import type { RetrievedSessionMemoryChunk } from "../../retrieval/memory/retrieveSessionMemoryChunks";
import type { RetrievedStructMemEntry } from "../../retrieval/memory/retrieveStructMemEntries";
import type { RetrievedStructMemConsolidation } from "../../retrieval/memory/retrieveStructMemConsolidations";
import type { RetrievedOpenThread } from "../../retrieval/memory/retrieveOpenThreads";
import type { RetrievedCanonChunk } from "../../retrieval/canon/retrieveCanonNarrative";
import type { RetrievedCanonScene } from "../../retrieval/canon/retrieveCanonTier3Pipeline";
import type { ContextCandidate, ContextCandidateSource } from "./contextCandidates";
import type { MemoryCorrectionContext } from "./memoryCorrections";

// ---------------------------------------------------------------------------
// Fakes -- cast to any to avoid exact-type brittleness; only exercised fields
// matter for these adapter-level tests.
// ---------------------------------------------------------------------------

const fakeMemory = {
  id: "mem_1",
  summary: "A memory.",
  cosineSimilarity: 0.8,
  importanceScore: 0.5,
  emotionScore: 0.3,
} as RetrievedMemory;

const fakeMemory2 = {
  id: "mem_2",
  summary: "Another memory.",
  cosineSimilarity: 0.6,
  importanceScore: 0.4,
  emotionScore: 0.2,
} as RetrievedMemory;

const fakeSessionChunk = {
  id: "chunk_1",
  chunkText: "Session chunk text.",
  turnStart: 1,
  turnEnd: 2,
  finalScore: 0.9,
} as RetrievedSessionMemoryChunk;

const fakeStructMemEntry = {
  id: "struct_1",
  entryType: "relationship",
  text: "Entry text.",
  turnIndex: 3,
  finalScore: 0.85,
} as RetrievedStructMemEntry;

const fakeStructMemConsolidation = {
  id: "consol_1",
  summaryText: "Consolidation summary.",
  turnStart: 1,
  turnEnd: 5,
  finalScore: 0.75,
  confidenceScore: 0.8,
} as RetrievedStructMemConsolidation;

const fakeOpenThread = {
  id: "thread_1",
  text: "Thread text.",
  sourceTurnIndex: 4,
  score: 0.7,
} as RetrievedOpenThread;

const fakeCanonChunk = {
  id: "canon_1",
  textContent: "Canon text.",
  sceneId: "scene_1",
  canonPriority: 1,
} as RetrievedCanonChunk;

const fakeCanonScene = {
  sceneId: "scene_1",
  title: "Scene 1",
  summary: "Scene summary.",
  units: [],
} as unknown as RetrievedCanonScene;

const fakeCandidate: ContextCandidate = {
  id: "mem_1",
  source: "interactive_memory",
  text: "A memory.",
  score: 0.8,
};

const fakeCanonCandidate: ContextCandidate = {
  id: "canon_1",
  source: "canon_chunk",
  text: "Canon text.",
  score: 0.9,
};

function fakeTurn(): ConversationTurn {
  return { turnIndex: 5, role: "user", content: "Hello" };
}

function makeSelected(
  id: string,
  source: ContextCandidateSource = "interactive_memory",
): MemoryRerankSelected {
  return { id, source, relevance: "required", usageInstruction: "must_use", reasonCode: "direct_continuity" };
}

function makeSuccessResult(
  selected: MemoryRerankSelected[] = [makeSelected("mem_1")],
): MemoryRerankResult {
  return {
    ok: true,
    output: {
      selected,
      rejected: [],
      finalContextMode: "selected_memory",
      needsEvidenceFallback: false,
    },
    inputTokens: 50,
    outputTokens: 20,
    timingMs: 100,
  };
}

function makeDiagnostics(
  memories: number,
  sessionRecall: number,
  structMemEntries: number,
  structMemConsolidations: number,
  openThreads: number,
): PromptMemoryContextSelection["diagnostics"] {
  const injectedCounts = {
    interactive_memory: memories,
    session_chunk: sessionRecall,
    structmem_entry: structMemEntries,
    structmem_consolidation: structMemConsolidations,
    open_thread: openThreads,
  };
  return {
    retrievedCounts: { ...injectedCounts },
    injectedCounts,
    droppedDuplicateCount: 0,
    droppedLowScoreCount: 0,
    droppedCorrectionCount: 0,
    droppedBudgetCount: 0,
    topSources: ["interactive_memory"],
    averageInjectedScore: null,
  };
}

function makeDefaultInput(
  overrides?: Partial<RerankContextInput>,
): RerankContextInput {
  return {
    userMessage: "Hello",
    structuredUserQuery: { userSpeech: "Hello" },
    plannerIntent: "scene_continuation",
    plannerHints: {
      sourcePriority: ["recent_chat", "interactive_memory"],
      queryVariants: {
        memory: ["hello"],
        structmem: [],
        structmemConsolidation: [],
        interactiveMemory: [],
        canon: [],
        web: [],
      },
      possibleMotif: false,
      possibleCanonClaim: false,
      possibleOldMemoryReference: false,
      possibleDurableMemoryReference: false,
    },
    recentTurns: [fakeTurn()],
    latestTurnDeltaText: undefined,
    continuityScope: "main",
    candidates: [fakeCandidate, fakeCanonCandidate],
    memories: [fakeMemory, fakeMemory2],
    sessionRecall: [fakeSessionChunk],
    structMemEntries: [fakeStructMemEntry],
    structMemConsolidations: [fakeStructMemConsolidation],
    openThreads: [fakeOpenThread],
    canonChunks: [fakeCanonChunk],
    canonScenes: [fakeCanonScene],
    sessionSummary: null,
    latestTurnDelta: null,
    memoryCorrections: [],
    retrievalPlan: {
      intent: "general",
      canonMode: "skip",
      durableMemoryTopK: 8,
      sessionRecallTopK: 12,
      structMemEntryTopK: 16,
      structMemConsolidationTopK: 4,
      openThreadTopK: 4,
      broadFailOpen: false,
      forceOpenThreads: false,
      contextNeed: {
        needsRecentTurns: true,
        needsOlderSessionRecall: false,
        needsDurableMemory: false,
        needsStructMem: false,
        needsStructMemConsolidation: false,
        needsCanon: false,
        needsWeb: false,
        structMemReason: "none",
        injectionMode: "skip",
        reason: "casual",
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("rerankContext", () => {
  it("applies reranker selection on success", async () => {
    const result = await rerankContext(makeDefaultInput(), {
      rerankCandidates: async () => makeSuccessResult(),
    });

    assert.strictEqual(result.rerankFallbackUsed, false);
    assert.strictEqual(result.rerankFallbackReason, null);
    assert.ok(result.rerankOutput);
    assert.strictEqual(result.rerankOutput!.selected.length, 1);
    assert.strictEqual(result.rerankOutput!.selected[0]!.id, "mem_1");
    // Selected context contains the chosen memory
    assert.strictEqual(result.selectedContext.memories.length, 1);
    assert.strictEqual(result.selectedContext.memories[0]!.id, "mem_1");
    // Non-selected sources are empty
    assert.strictEqual(result.selectedContext.sessionRecall.length, 0);
    assert.strictEqual(result.selectedContext.structMemEntries.length, 0);
    assert.strictEqual(result.selectedContext.structMemConsolidations.length, 0);
    assert.strictEqual(result.selectedContext.openThreads.length, 0);
    // No canon candidate was selected -- canon should be empty
    assert.strictEqual(result.canonChunks.length, 0);
    assert.strictEqual(result.canonScenes.length, 0);
  });

  it("filters canon by selected canon IDs on rerank success", async () => {
    const result = await rerankContext(makeDefaultInput(), {
      rerankCandidates: async () =>
        makeSuccessResult([makeSelected("canon_1", "canon_chunk")]),
    });

    assert.strictEqual(result.rerankFallbackUsed, false);
    // Canon chunk should be kept because it was selected
    assert.strictEqual(result.canonChunks.length, 1);
    assert.strictEqual(result.canonChunks[0]!.id, "canon_1");
  });

  it("falls back to deterministic selector when reranker fails", async () => {
    let deterministicCalled = false;

    const result = await rerankContext(makeDefaultInput(), {
      rerankCandidates: async (): Promise<MemoryRerankResult> => ({
        ok: false,
        fallbackReason: "rerank_llm_failed: parsing error",
        timingMs: 50,
      }),
      selectPromptMemoryContext(input) {
        deterministicCalled = true;
        return {
          memories: input.memories,
          sessionRecall: input.sessionRecall,
          structMemEntries: input.structMemEntries,
          structMemConsolidations: input.structMemConsolidations,
          openThreads: input.openThreads,
          diagnostics: makeDiagnostics(
            input.memories.length,
            input.sessionRecall.length,
            input.structMemEntries.length,
            input.structMemConsolidations.length,
            input.openThreads.length,
          ),
        };
      },
    });

    assert.ok(deterministicCalled, "deterministic selector should be called");
    assert.strictEqual(result.rerankFallbackUsed, true);
    assert.strictEqual(result.rerankFallbackReason, "rerank_llm_failed: parsing error");
    assert.strictEqual(result.rerankOutput, null);
    // Fallback keeps original unfiltered source arrays
    assert.strictEqual(result.selectedContext.memories.length, 2);
    assert.strictEqual(result.selectedContext.sessionRecall.length, 1);
    assert.strictEqual(result.selectedContext.structMemEntries.length, 1);
    assert.strictEqual(result.selectedContext.structMemConsolidations.length, 1);
    assert.strictEqual(result.selectedContext.openThreads.length, 1);
    // Fallback preserves original canon (not filtered)
    assert.strictEqual(result.canonChunks.length, 1);
    assert.strictEqual(result.canonScenes.length, 1);
  });

  it("preserves critical singleton context on rerank success", async () => {
    const result = await rerankContext(
      makeDefaultInput({
        sessionSummary: {
          id: "sum_1",
          sessionId: "s1",
          characterId: "c1",
          playerId: "p1",
          lastSummarizedTurnIndex: 10,
          summaryJson: {},
          summaryText: "Session summary text",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        latestTurnDelta: {
          kind: "latest_turn_delta",
          sourceTurnStart: 8,
          sourceTurnEnd: 9,
          expiresAfterTurn: 13,
          facts: ["fact 1"],
          pendingActions: ["action 1"],
          relationshipSignals: [],
        },
        memoryCorrections: [
          { sourceTurnIndex: 3, oldClaim: "wrong", correctedClaim: "right" },
        ],
      }),
      { rerankCandidates: async () => makeSuccessResult() },
    );

    assert.ok(result.filteredSessionSummary);
    assert.strictEqual(result.filteredSessionSummary!.summaryText, "Session summary text");
    assert.ok(result.filteredLatestTurnDelta);
    assert.strictEqual(result.filteredLatestTurnDelta!.kind, "latest_turn_delta");
    assert.strictEqual(result.filteredMemoryCorrections.length, 1);
  });

  it("reports timing for both rerank and fallback", async () => {
    const result = await rerankContext(makeDefaultInput(), {
      rerankCandidates: async (): Promise<MemoryRerankResult> => ({
        ok: false,
        fallbackReason: "timeout",
        timingMs: 200,
      }),
      selectPromptMemoryContext(input) {
        return {
          memories: input.memories,
          sessionRecall: input.sessionRecall,
          structMemEntries: input.structMemEntries,
          structMemConsolidations: input.structMemConsolidations,
          openThreads: input.openThreads,
          diagnostics: makeDiagnostics(
            input.memories.length,
            input.sessionRecall.length,
            input.structMemEntries.length,
            input.structMemConsolidations.length,
            input.openThreads.length,
          ),
        };
      },
    });

    assert.strictEqual(result.rerankMs, 200);
    assert.ok(result.selectorFallbackMs !== undefined && result.selectorFallbackMs >= 0);
  });
});

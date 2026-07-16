import { describe, it } from "node:test";
import assert from "node:assert";
import { rerankContext, type RerankContextInput } from "./rerankContext";
import type { MemoryRerankResult, MemoryRerankSelected } from "../retrieval/memoryRerank";
import type { PromptMemoryContextSelection } from "./promptMemoryContextSelector";
import type { RetrievedMemory } from "../../retrieval/memory/retrieveInteractiveMemories";
import type { RetrievedSessionMemoryChunk } from "../../retrieval/memory/retrieveSessionMemoryChunks";
import type { RetrievedStructMemEntry } from "../../retrieval/memory/retrieveStructMemEntries";
import type { RetrievedStructMemConsolidation } from "../../retrieval/memory/retrieveStructMemConsolidations";
import type { RetrievedOpenThread } from "../../retrieval/memory/retrieveOpenThreads";
import type { RetrievedCanonChunk } from "../../retrieval/canon/retrieveCanonNarrative";
import type { RetrievedCanonScene } from "../../retrieval/canon/retrieveCanonTier3Pipeline";
import type { ContextCandidate, ContextCandidateSource } from "./contextCandidates";

const fakeMemory = { id: "mem_1", summary: "A memory.", cosineSimilarity: 0.8, importanceScore: 0.5, emotionScore: 0.3 } as RetrievedMemory;
const fakeCandidate: ContextCandidate = { id: "mem_1", source: "interactive_memory", text: "A memory.", score: 0.8 };
const fakeCanonCandidate: ContextCandidate = { id: "canon_1", source: "canon_chunk", text: "Canon text.", score: 0.9 };
function makeSelected(id: string, source: ContextCandidateSource = "interactive_memory"): MemoryRerankSelected { return { id, source, relevance: "required", usageInstruction: "must_use", reasonCode: "direct_continuity" }; }
function makeSuccessResult(selected: MemoryRerankSelected[] = [makeSelected("mem_1")]): MemoryRerankResult { return { ok: true, output: { selected, rejected: [], finalContextMode: "selected_memory", needsEvidenceFallback: false }, inputTokens: 50, outputTokens: 20, timingMs: 100 }; }
function makeDiagnostics(memories: number, sessionRecall: number, structMemEntries: number, structMemConsolidations: number, openThreads: number): PromptMemoryContextSelection["diagnostics"] {
  const ic = { interactive_memory: memories, session_chunk: sessionRecall, structmem_entry: structMemEntries, structmem_consolidation: structMemConsolidations, open_thread: openThreads };
  return { retrievedCounts: { ...ic }, injectedCounts: ic, droppedDuplicateCount: 0, droppedLowScoreCount: 0, droppedCorrectionCount: 0, droppedBudgetCount: 0, topSources: ["interactive_memory"], averageInjectedScore: null };
}
function makeDefaultInput(overrides?: Partial<RerankContextInput>): RerankContextInput {
  return { userMessage: "Hello", structuredUserQuery: { userSpeech: "Hello" }, plannerIntent: "scene_continuation", plannerHints: { sourcePriority: ["recent_chat", "interactive_memory"], queryVariants: { memory: ["hello"], structmem: [], structmemConsolidation: [], interactiveMemory: [], canon: [], web: [] }, possibleMotif: false, possibleCanonClaim: false, possibleOldMemoryReference: false, possibleDurableMemoryReference: false }, recentTurns: [{ turnIndex: 5, role: "user", content: "Hello" }], latestTurnDeltaText: undefined, continuityScope: "main", candidates: [fakeCandidate, fakeCanonCandidate], memories: [fakeMemory, { id: "mem_2", summary: "Another memory.", cosineSimilarity: 0.6, importanceScore: 0.4, emotionScore: 0.2 } as RetrievedMemory], sessionRecall: [{ id: "chunk_1", chunkText: "Session chunk text.", turnStart: 1, turnEnd: 2, finalScore: 0.9 } as RetrievedSessionMemoryChunk], structMemEntries: [{ id: "struct_1", entryType: "relationship", text: "Entry text.", turnIndex: 3, finalScore: 0.85 } as RetrievedStructMemEntry], structMemConsolidations: [{ id: "consol_1", summaryText: "Consolidation summary.", turnStart: 1, turnEnd: 5, finalScore: 0.75, confidenceScore: 0.8 } as RetrievedStructMemConsolidation], openThreads: [{ id: "thread_1", text: "Thread text.", sourceTurnIndex: 4, score: 0.7 } as RetrievedOpenThread], canonChunks: [{ id: "canon_1", textContent: "Canon text.", sceneId: "scene_1", canonPriority: 1 } as RetrievedCanonChunk], canonScenes: [{ sceneId: "scene_1", title: "Scene 1", summary: "Scene summary.", units: [] } as unknown as RetrievedCanonScene], sessionSummary: null, latestTurnDelta: null, memoryCorrections: [], retrievalPlan: { intent: "general", canonMode: "skip", durableMemoryTopK: 8, sessionRecallTopK: 12, structMemEntryTopK: 16, structMemConsolidationTopK: 4, openThreadTopK: 4, broadFailOpen: false, forceOpenThreads: false, contextNeed: { needsRecentTurns: true, needsOlderSessionRecall: false, needsDurableMemory: false, needsStructMem: false, needsStructMemConsolidation: false, needsCanon: false, needsWeb: false, structMemReason: "none", injectionMode: "skip", reason: "casual" } }, ...overrides };
}

describe("rerankContext", () => {
  it("applies reranker selection, filters canon, preserves critical context, handles canon_fact", async () => {
    // reranker selection success
    let result = await rerankContext(makeDefaultInput(), { rerankCandidates: async () => makeSuccessResult() });
    assert.equal(result.rerankFallbackUsed, false, "success — no fallback");
    assert.equal(result.rerankOutput!.selected.length, 1, "selected count");
    assert.equal(result.selectedContext.memories.length, 1, "memory kept");
    assert.equal(result.selectedContext.sessionRecall.length, 0, "session recall empty");
    assert.equal(result.selectedContext.structMemEntries.length, 0, "structmem empty");
    assert.equal(result.selectedContext.structMemConsolidations.length, 0, "structmem consol empty");
    assert.equal(result.selectedContext.openThreads.length, 0, "open threads empty");
    assert.equal(result.canonChunks.length, 0, "canon chunks empty");
    assert.equal(result.canonScenes.length, 0, "canon scenes empty");

    // canon filter
    result = await rerankContext(makeDefaultInput(), { rerankCandidates: async () => makeSuccessResult([makeSelected("canon_1", "canon_chunk")]) });
    assert.equal(result.canonChunks.length, 1, "canon chunk kept");
    assert.equal(result.canonChunks[0]!.id, "canon_1", "correct canon");

    // canon_fact selection
    const factId = "fact_scene_1_2";
    const sceneWithFacts = { sceneId: "scene_1", arcKey: "a", chapterId: "ch1", episodeId: "ep1", chapterName: "Ch1", episodeLabel: "Ep1", sceneTitle: "Test Scene", sceneSummary: "A test scene.", units: [], facts: [{ subject: "A", predicate: "is", object: "B", textForm: "A is B." }, { subject: "C", predicate: "has", object: "D", textForm: "C has D." }, { subject: "E", predicate: "loves", object: "F", textForm: "E loves F." }], rankScore: 0.9, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } } as unknown as RetrievedCanonScene;
    result = await rerankContext(makeDefaultInput({ canonScenes: [sceneWithFacts], candidates: [fakeCandidate, { id: factId, source: "canon_fact" as const, text: "E loves F.", score: 0.9 } as ContextCandidate] }), { rerankCandidates: async () => makeSuccessResult([{ id: factId, source: "canon_fact", relevance: "required", usageInstruction: "must_use", reasonCode: "canon_required" }]) });
    assert.equal(result.canonScenes.length, 1, "canon_fact scene kept");
    assert.equal(result.canonScenes[0]!.facts.length, 1, "only selected fact");

    // critical context preserved
    result = await rerankContext(makeDefaultInput({ sessionSummary: { id: "sum_1", sessionId: "s1", characterId: "c1", playerId: "p1", lastSummarizedTurnIndex: 10, summaryJson: {}, summaryText: "Session summary text", createdAt: new Date(), updatedAt: new Date() }, latestTurnDelta: { kind: "latest_turn_delta", sourceTurnStart: 8, sourceTurnEnd: 9, expiresAfterTurn: 13, facts: ["fact 1"], pendingActions: ["action 1"], relationshipSignals: [] }, memoryCorrections: [{ sourceTurnIndex: 3, oldClaim: "wrong", correctedClaim: "right" }] }), { rerankCandidates: async () => makeSuccessResult() });
    assert.ok(result.filteredLatestTurnDelta, "delta preserved");
    assert.equal(result.filteredLatestTurnDelta!.kind, "latest_turn_delta", "delta kind");
    assert.equal(result.filteredLatestTurnDelta!.sourceTurnStart, 8, "delta sourceTurnStart");
    assert.equal(result.filteredSessionSummary!.summaryText, "Session summary text", "summary preserved");
    assert.equal(result.filteredMemoryCorrections.length, 1, "corrections preserved");
  });

  it("falls back to deterministic selector when reranker fails and reports timing", async () => {
    let deterministicCalled = false;
    const result = await rerankContext(makeDefaultInput(), {
      rerankCandidates: async (): Promise<MemoryRerankResult> => ({ ok: false, fallbackReason: "rerank_llm_failed: parsing error", timingMs: 50 }),
      selectPromptMemoryContext(input) { deterministicCalled = true; return { memories: input.memories, sessionRecall: input.sessionRecall, structMemEntries: input.structMemEntries, structMemConsolidations: input.structMemConsolidations, openThreads: input.openThreads, diagnostics: makeDiagnostics(input.memories.length, input.sessionRecall.length, input.structMemEntries.length, input.structMemConsolidations.length, input.openThreads.length) }; },
    });
    assert.ok(deterministicCalled, "deterministic called");
    assert.equal(result.rerankFallbackUsed, true, "fallback flag");
    assert.equal(result.rerankFallbackReason, "rerank_llm_failed: parsing error", "fallback reason");
    assert.equal(result.rerankOutput, null, "no rerank output");
    assert.equal(result.selectedContext.memories.length, 2, "fallback keeps all memories");
    assert.equal(result.selectedContext.sessionRecall.length, 1, "fallback keeps session recall");
    assert.equal(result.selectedContext.structMemEntries.length, 1, "fallback keeps structmem");
    assert.equal(result.selectedContext.structMemConsolidations.length, 1, "fallback keeps consol");
    assert.equal(result.selectedContext.openThreads.length, 1, "fallback keeps open threads");
    assert.equal(result.canonChunks.length, 1, "fallback keeps canon");
    assert.equal(result.canonScenes.length, 1, "fallback keeps canon scenes");

    // timing report
    const timedResult = await rerankContext(makeDefaultInput(), {
      rerankCandidates: async (): Promise<MemoryRerankResult> => ({ ok: false, fallbackReason: "timeout", timingMs: 200 }),
      selectPromptMemoryContext(input) { return { memories: input.memories, sessionRecall: input.sessionRecall, structMemEntries: input.structMemEntries, structMemConsolidations: input.structMemConsolidations, openThreads: input.openThreads, diagnostics: makeDiagnostics(input.memories.length, input.sessionRecall.length, input.structMemEntries.length, input.structMemConsolidations.length, input.openThreads.length) }; },
    });
    assert.equal(timedResult.rerankMs, 200, "rerank timing");
    assert.ok(timedResult.selectorFallbackMs !== undefined && timedResult.selectorFallbackMs >= 0, "fallback timing");
  });
});

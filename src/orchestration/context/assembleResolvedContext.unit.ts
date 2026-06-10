import { describe, it } from "node:test";
import assert from "node:assert";
import { assembleResolvedContext, type PreRerankContext } from "./resolveContext";
import type { RerankContextOutput } from "./rerankContext";
import type { ChatSession } from "../../db/schema/chat";
import type { RetrievedMemory } from "../../retrieval/memory/retrieveInteractiveMemories";

function fakeSession(): ChatSession { return { sessionId: "sess_test", characterId: "zuo_ran", playerId: "p-001", mode: "canonical_live", continuityScope: "main", continuityFamily: "main_world", personaOverlayId: null, memoryNamespace: "main", pinnedTime: null, pinnedLocation: null, writebackPolicy: "full_writeback", sessionSummary: null, displayTitle: null, thinking: true, temperature: 1, deletedAt: null, createdAt: new Date(), updatedAt: new Date() }; }
const fakeMemory = { id: "mem_1", summary: "A memory.", cosineSimilarity: 0.8, importanceScore: 0.5, emotionScore: 0.3 } as RetrievedMemory;
const traceNoop = async (input: Record<string, unknown>): Promise<Record<string, unknown>> => input;

function makePre(overrides?: Partial<PreRerankContext>): PreRerankContext {
  return { session: fakeSession(), userMessage: "hello", characterDefaults: { character_id: "zuo_ran", name: "Zuo Ran" } as any, contextPlannerOutput: { queryRewrite: { intent: "general", confidence: 0.9, segments: [], combined_for_embedding: "chat", entities: [], parseOk: true, structuralParseOk: true, labelOk: true }, structuredUserQuery: { userSpeech: "hello" }, intent: "scene_continuation", entities: [], retrievalHints: { sourcePriority: ["recent_chat"], queryVariants: { memory: [], structmem: [], structmemConsolidation: [], interactiveMemory: [], canon: [], web: [] }, possibleMotif: false, possibleCanonClaim: false, possibleOldMemoryReference: false, possibleDurableMemoryReference: false }, confidence: 0.9, reason: "casual" }, queryRewrite: { intent: "general", confidence: 0.9, segments: [], combined_for_embedding: "chat", entities: [], parseOk: true, structuralParseOk: true, labelOk: true }, queryRewriteMs: 10, queryTextAnnotationFallback: false, retrievalPlan: { intent: "general", canonMode: "skip", durableMemoryTopK: 8, sessionRecallTopK: 12, structMemEntryTopK: 16, structMemConsolidationTopK: 4, openThreadTopK: 4, broadFailOpen: false, forceOpenThreads: false, contextNeed: { needsRecentTurns: true, needsOlderSessionRecall: false, needsDurableMemory: false, needsStructMem: false, needsStructMemConsolidation: false, needsCanon: false, needsWeb: false, structMemReason: "none", injectionMode: "skip", reason: "casual" } }, queryEmbedding: [0.1, 0.2], canonQueryEmbedding: [0.1, 0.2], hypotheticalQueryEmbedding: undefined, motifQueryEmbeddings: undefined, memories: [fakeMemory], canonChunks: [], canonScenes: [], recentTurns: [{ turnIndex: 5, role: "user", content: "hello" }], sessionSummary: null, sessionStateRow: null, latestRoleplayTurnIndex: null, isFirstUserTurn: true, sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], motifSignal: undefined, motifProbe: undefined, derivedState: { inferredMood: "calm", inferredActivity: "conversing", conversationalStance: "neutral" }, memoryCorrections: [], latestTurnDelta: null, shortlist: { candidates: [], diagnostics: { totalRetrieved: 0, totalShortlisted: 0, countsBySource: {}, truncatedByTotalCap: 0 } }, shortlistMs: 5, latestTurnDeltaText: undefined, motifProbeText: undefined, startedAt: Date.now(), embeddingsMs: 10, mainRetrievalMs: 20, olderRecallMs: 10, openThreadsMs: 5, olderRecallExclusiveFirst: 0, useFusedMemoryQuery: false, latestFrontierTurn: -1, ...overrides };
}

function makeResult(overrides?: Partial<RerankContextOutput>): RerankContextOutput {
  const inj = { interactive_memory: 1, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 };
  return { selectedContext: { memories: [fakeMemory], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], diagnostics: { retrievedCounts: { ...inj }, injectedCounts: inj, droppedDuplicateCount: 0, droppedLowScoreCount: 0, droppedCorrectionCount: 0, droppedBudgetCount: 0, topSources: ["interactive_memory"], averageInjectedScore: 0.8 } }, rerankOutput: { selected: [{ id: "mem_1", source: "interactive_memory", relevance: "required", usageInstruction: "must_use", reasonCode: "direct_continuity" }], rejected: [], finalContextMode: "selected_memory", needsEvidenceFallback: false, resolutionDiagnostics: { exactIdCount: 1, numericIndexCount: 0, unresolvedCount: 0 } }, rerankFallbackUsed: false, rerankFallbackReason: null, rerankMs: 50, selectorFallbackMs: undefined, canonChunks: [], canonScenes: [], filteredSessionSummary: null, filteredLatestTurnDelta: null, filteredMemoryCorrections: [], ...overrides };
}

describe("assembleResolvedContext", () => {
  it("produces ResolvedContext with rerank success, fallback, and structmem expansions", async () => {
    let result = await assembleResolvedContext(makePre(), makeResult(), { traceRetrievalDiagnostics: traceNoop });
    assert.ok(result, "result exists");
    assert.equal(result.memories.length, 1, "memories present");
    assert.equal(result.isFirstUserTurn, true, "isFirstUserTurn");
    assert.ok(result.rerankOutput, "rerank output present");
    assert.equal(result.queryRewrite.intent, "general", "query rewrite");
    assert.ok(result.recallThoughtContext, "recall thought context");

    // fallback
    const fallbackResult = makeResult({ rerankOutput: null, rerankFallbackUsed: true, rerankFallbackReason: "rerank_llm_failed: timeout" });
    result = await assembleResolvedContext(makePre(), fallbackResult, { traceRetrievalDiagnostics: traceNoop });
    assert.equal(result.rerankOutput, null, "no rerank output on fallback");
    assert.equal(result.memories.length, 1, "memories still present");
    assert.ok(result.recallThoughtContext, "recall thought on fallback");

    // structmem expansion
    const fakeEntry = { id: "struct_1", entryType: "relationship", text: "Entry text", turnIndex: 3, finalScore: 0.85 } as any;
    const pre = makePre({ structMemEntries: [fakeEntry] });
    const rerankResult = makeResult();
    rerankResult.selectedContext.structMemEntries = [fakeEntry];
    result = await assembleResolvedContext(pre, rerankResult, { traceRetrievalDiagnostics: traceNoop });
    assert.ok(Array.isArray(result.structMemEntryContextExpansions), "expansions array");
    assert.equal(result.structMemEntries.length, 1, "structmem entries");
  });
});

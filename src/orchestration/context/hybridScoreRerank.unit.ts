import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hybridScoreSelect, runHybridScoreRerank } from "./hybridScoreRerank";
import type { ContextCandidate } from "./contextCandidates";
import type { RerankContextInput } from "./rerankContext";
import type { RetrievedCanonChunk } from "../../retrieval/canon/retrieveCanonNarrative";
import type { InternalLogicEvidenceHit } from "../../retrieval/internalLogic/searchInternalLogicEvidence";

function makeCandidate(id: string, source: ContextCandidate["source"], score: number | null = 0.5): ContextCandidate {
  return { id, source, text: `text for ${id}`, score };
}

describe("hybridScoreSelect", () => {
  it("handles empty input, source priority, scoring, intent, caps", () => {
    let { selected } = hybridScoreSelect([], "scene_continuation");
    assert.equal(selected.length, 0, "empty → empty");

    // non-empty should have at least 1
    selected = hybridScoreSelect([makeCandidate("sc_1", "session_chunk", 0.8)], "scene_continuation").selected;
    assert.ok(selected.length >= 1, "non-empty has content");

    const equalScores = [makeCandidate("canon_1", "canon_chunk", 0.8), makeCandidate("mem_1", "interactive_memory", 0.8), makeCandidate("sc_1", "session_chunk", 0.8)];
    ({ selected } = hybridScoreSelect(equalScores, "scene_continuation"));
    assert.equal(selected[0]!.id, "sc_1", "session_chunk priority first");
    assert.equal(selected[1]!.id, "mem_1", "memory second");
    assert.equal(selected[2]!.id, "canon_1", "canon last");

    const diffScores = [makeCandidate("mem_low", "interactive_memory", 0.3), makeCandidate("mem_high", "interactive_memory", 0.9)];
    selected = hybridScoreSelect(diffScores, "scene_continuation").selected;
    assert.ok(selected.findIndex((c) => c.id === "mem_high") < selected.findIndex((c) => c.id === "mem_low"), "higher score first");

    // explicit_recall requires memory and structmem
    const intentCandidates = [makeCandidate("canon_1", "canon_chunk", 0.9), makeCandidate("mem_1", "interactive_memory", 0.5), makeCandidate("sc_1", "session_chunk", 0.5), makeCandidate("struct_1", "structmem_entry", 0.5)];
    selected = hybridScoreSelect(intentCandidates, "explicit_recall").selected;
    assert.ok(selected.some((c) => c.id === "mem_1"), "memory for explicit_recall");
    assert.ok(selected.some((c) => c.id === "struct_1"), "structmem for explicit_recall");

    // canon_question includes canon chunk
    selected = hybridScoreSelect([makeCandidate("canon_1", "canon_chunk", 0.5), makeCandidate("mem_1", "interactive_memory", 0.9)], "canon_question").selected;
    assert.ok(selected.some((c) => c.source === "canon_chunk"), "canon chunk for canon_question");

    // canon_question includes canon_fact
    selected = hybridScoreSelect([makeCandidate("fact_1", "canon_fact", 0.8), makeCandidate("mem_1", "interactive_memory", 0.9)], "canon_question").selected;
    assert.ok(selected.some((c) => c.source === "canon_fact"), "canon_fact for canon_question");

    // per-source caps
    selected = hybridScoreSelect(Array.from({ length: 10 }, (_, i) => makeCandidate(`struct_${i}`, "structmem_entry", 0.8)), "explicit_recall").selected;
    assert.equal(selected.filter((c) => c.source === "structmem_entry").length, 3, "structmem cap 3");

    // total cap 12
    selected = hybridScoreSelect(Array.from({ length: 20 }, (_, i) => makeCandidate(`sc_${i}`, "session_chunk", 0.8)), "scene_continuation").selected;
    assert.ok(selected.length <= 12, "total cap 12");

    // internal_logic_evidence
    selected = hybridScoreSelect([makeCandidate("internal_logic_evidence_ev_001", "internal_logic_evidence", 0.7), makeCandidate("internal_logic_evidence_ev_002", "internal_logic_evidence", 0.6)], "scene_continuation").selected;
    assert.equal(selected.filter((c) => c.source === "internal_logic_evidence").length, 2, "evidence selected");

    selected = hybridScoreSelect(Array.from({ length: 5 }, (_, i) => makeCandidate(`internal_logic_evidence_ev_${i}`, "internal_logic_evidence", 0.5)), "scene_continuation").selected;
    assert.equal(selected.filter((c) => c.source === "internal_logic_evidence").length, 2, "evidence cap 2");
  });
});

function makeHybridInput(overrides: Partial<RerankContextInput> & { evidenceHits?: InternalLogicEvidenceHit[] }): RerankContextInput {
  return { userMessage: "hi", structuredUserQuery: { userSpeech: "hi" }, plannerIntent: "scene_continuation", plannerHints: { sourcePriority: [], queryVariants: { memory: [], structmem: [], structmemConsolidation: [], interactiveMemory: [], canon: [], web: [] }, possibleMotif: false, possibleCanonClaim: false, possibleOldMemoryReference: false, possibleDurableMemoryReference: false }, recentTurns: [], continuityScope: "main_married", candidates: [], memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], canonChunks: [], canonScenes: [], sessionSummary: null as any, latestTurnDelta: null, memoryCorrections: [], retrievalPlan: { intent: "scene_continuation" as const, canonMode: "skip" as const, broadFailOpen: false, forceOpenThreads: false, durableMemoryTopK: 0, sessionRecallTopK: 0, structMemEntryTopK: 0, structMemConsolidationTopK: 0, openThreadTopK: 0, contextNeed: { needsRecentTurns: false, needsOlderSessionRecall: false, needsDurableMemory: false, needsStructMem: false, needsStructMemConsolidation: false, needsCanon: false, needsWeb: false, injectionMode: "compact" as const, reason: "" } }, ...overrides, internalLogicEvidence: overrides.evidenceHits };
}

describe("runHybridScoreRerank", () => {
  const evidenceHit: InternalLogicEvidenceHit = { id: "ev_001", characterId: "zuo_ran", node: "core_fear", claimText: "Claim", evidenceText: "Evidence", arcKey: null, chapterKey: null, episodeLabel: null, sceneOrder: null, unitIndex: null, scopeApplicability: {}, sourceKind: "canon", confidenceScore: null, metadata: {}, cosineSimilarity: 0.5, finalScore: 0.5 };

  it("returns correct finalContextMode and diagnostics for various selections", async () => {
    // evidence-only
    let r = await runHybridScoreRerank(makeHybridInput({ candidates: [makeCandidate("internal_logic_evidence_ev_001", "internal_logic_evidence")], evidenceHits: [evidenceHit] }));
    assert.equal(r.selectedContext.internalLogicEvidence?.length, 1, "evidence selected");
    assert.equal(r.selectedContext.internalLogicEvidence![0]!.id, "ev_001", "evidence id");
    assert.equal(r.rerankOutput.finalContextMode, "selected_memory", "evidence → selected_memory");

    // canon-only
    r = await runHybridScoreRerank(makeHybridInput({ candidates: [makeCandidate("canon_1", "canon_chunk")], canonChunks: [{ id: "canon_1", textContent: "canon", sceneId: "s1", arcKey: "a", chapterName: "ch", contentType: "narrative", speaker: null, canonPriority: null, rankScore: 0.5 } as RetrievedCanonChunk] }));
    assert.equal(r.rerankOutput.finalContextMode, "selected_canon", "canon → selected_canon");

    // canon + evidence
    r = await runHybridScoreRerank(makeHybridInput({ candidates: [makeCandidate("canon_1", "canon_chunk"), makeCandidate("internal_logic_evidence_ev_001", "internal_logic_evidence")], canonChunks: [{ id: "canon_1", textContent: "canon", sceneId: "s1", arcKey: "a", chapterName: "ch", contentType: "narrative", speaker: null, canonPriority: null, rankScore: 0.5 } as RetrievedCanonChunk], evidenceHits: [evidenceHit] }));
    assert.equal(r.rerankOutput.finalContextMode, "memory_and_canon", "canon+evidence → memory_and_canon");

    // no candidates
    r = await runHybridScoreRerank(makeHybridInput({ candidates: [] }));
    assert.equal(r.rerankOutput.finalContextMode, "recent_only", "empty → recent_only");

    // diagnostics
    r = await runHybridScoreRerank(makeHybridInput({ candidates: [makeCandidate("internal_logic_evidence_ev_001", "internal_logic_evidence")], evidenceHits: [evidenceHit] }));
    const d = r.selectedContext.diagnostics;
    assert.equal((d.retrievedCounts as any).internal_logic_evidence, 1, "diagnostics retrieved");
    assert.equal((d.injectedCounts as any).internal_logic_evidence, 1, "diagnostics injected");
  });
});

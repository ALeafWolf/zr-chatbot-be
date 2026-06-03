import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextCandidate } from "./contextCandidates";
import type { RetrievedCanonScene } from "../../retrieval/canon/retrieveCanonTier3Pipeline";
import { applyCandidateSelection, filterCanonBySelection, buildPromptContextCandidates, canonFactCandidateId } from "./contextCandidates";

function makeCandidate(id: string, source: string, extra?: Partial<ContextCandidate>): ContextCandidate {
  return { id, source: source as ContextCandidate["source"], text: extra?.text ?? `candidate ${id}`, score: extra?.score ?? 0.5, turnStart: extra?.turnStart ?? null, turnEnd: extra?.turnEnd ?? null };
}

describe("applyCandidateSelection singleton sources", () => {
  it("marks session_summary, latest_turn_delta, corrections, and filters by selected IDs", () => {
    let r = applyCandidateSelection({ shortlist: [makeCandidate("session_summary", "session_summary"), makeCandidate("latest_turn_delta", "latest_turn_delta")], selectedIds: ["session_summary"], memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [] });
    assert.equal(r.sessionSummarySelected, true, "session_summary selected");
    assert.equal(r.latestTurnDeltaSelected, false, "latest_turn_delta not selected");

    r = applyCandidateSelection({ shortlist: [makeCandidate("session_summary", "session_summary"), makeCandidate("latest_turn_delta", "latest_turn_delta")], selectedIds: ["latest_turn_delta"], memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [] });
    assert.equal(r.latestTurnDeltaSelected, true, "latest_turn_delta selected");
    assert.equal(r.sessionSummarySelected, false, "session_summary not selected");

    r = applyCandidateSelection({ shortlist: [makeCandidate("session_summary", "session_summary"), makeCandidate("latest_turn_delta", "latest_turn_delta")], selectedIds: [], memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [] });
    assert.equal(r.sessionSummarySelected, false, "both false when empty");
    assert.equal(r.latestTurnDeltaSelected, false, "both false when empty");

    r = applyCandidateSelection({ shortlist: [makeCandidate("correction_2", "memory_correction"), makeCandidate("correction_5", "memory_correction"), makeCandidate("correction_8", "memory_correction")], selectedIds: ["correction_2", "correction_8"], memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [] });
    assert.deepEqual(r.selectedCorrectionIds, ["correction_2", "correction_8"], "selected corrections");

    r = applyCandidateSelection({ shortlist: [makeCandidate("correction_2", "memory_correction")], selectedIds: [], memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [] });
    assert.deepEqual(r.selectedCorrectionIds, [], "no corrections selected");

    const sessionRecall = [{ id: "chunk_a", chunkText: "a", turnStart: 1, turnEnd: 2, finalScore: 0.9, cosineSimilarity: 0.8, chunkType: "scene" }, { id: "chunk_b", chunkText: "b", turnStart: 3, turnEnd: 4, finalScore: 0.7, cosineSimilarity: 0.6, chunkType: "scene" }] as any;
    r = applyCandidateSelection({ shortlist: [makeCandidate("chunk_a", "session_chunk"), makeCandidate("chunk_b", "session_chunk")], selectedIds: ["chunk_a"], memories: [], sessionRecall, structMemEntries: [], structMemConsolidations: [], openThreads: [] });
    assert.equal(r.sessionRecall.length, 1, "chunk_a filtered");
    assert.equal(r.sessionRecall[0]!.id, "chunk_a", "chunk_a kept");

    const openThreads = [{ id: "ot1", source: "session_summary", text: "t1", status: "open", sourceTurnIndex: 0, score: 0.9 }, { id: "ot2", source: "session_summary", text: "t2", status: "open", sourceTurnIndex: 1, score: 0.8 }] as any;
    r = applyCandidateSelection({ shortlist: [makeCandidate("ot1", "open_thread"), makeCandidate("ot2", "open_thread")], selectedIds: ["ot1"], memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads });
    assert.equal(r.openThreads.length, 1, "ot1 filtered");
    assert.equal(r.openThreads[0]!.id, "ot1", "ot1 kept");
  });
});

describe("filterCanonBySelection", () => {
  const canonChunks = [{ id: "chunk_a", sceneId: "scene_1", textContent: "alpha", contentType: "narrative", arcKey: "a", chapterName: "" }, { id: "chunk_b", sceneId: "scene_1", textContent: "beta", contentType: "narrative", arcKey: "a", chapterName: "" }, { id: "chunk_c", sceneId: "scene_2", textContent: "gamma", contentType: "narrative", arcKey: "b", chapterName: "" }] as Parameters<typeof filterCanonBySelection>[0];
  const canonScenes = [{ sceneId: "scene_1", arcKey: "a", chapterId: "ch1", episodeId: "ep1", chapterName: "Ch1", episodeLabel: "Ep1", sceneTitle: null, sceneSummary: null, units: [], facts: [], rankScore: 0.5, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } }, { sceneId: "scene_2", arcKey: "b", chapterId: "ch2", episodeId: "ep2", chapterName: "Ch2", episodeLabel: "Ep2", sceneTitle: null, sceneSummary: null, units: [], facts: [], rankScore: 0.4, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } }] as unknown as Parameters<typeof filterCanonBySelection>[1];
  const sceneWithFacts = { sceneId: "scene_a", arcKey: "a", chapterId: "ch1", episodeId: "ep1", chapterName: "Ch1", episodeLabel: "Ep1", sceneTitle: null, sceneSummary: null, units: [], facts: [{ subject: "A", predicate: "is", object: "B", textForm: "A is B." }, { subject: "C", predicate: "has", object: "D", textForm: "C has D." }, { subject: "E", predicate: "loves", object: "F", textForm: "E loves F." }], rankScore: 0.9, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } } as unknown as Parameters<typeof filterCanonBySelection>[1][number];

  it("filters chunks/scenes by selection, handles facts-only and mixed", () => {
    let r = filterCanonBySelection(canonChunks, canonScenes, []);
    assert.deepEqual(r.canonChunks, [], "empty selection → empty");
    assert.deepEqual(r.canonScenes, [], "empty selection → empty");

    r = filterCanonBySelection(canonChunks, canonScenes, ["chunk_a"]);
    assert.equal(r.canonChunks.length, 1, "chunk_a kept");
    assert.equal(r.canonChunks[0]!.id, "chunk_a", "correct id");
    assert.deepEqual(r.canonScenes, [], "scenes cleared");

    r = filterCanonBySelection(canonChunks, canonScenes, ["chunk_a", "chunk_c"]);
    assert.equal(r.canonChunks.length, 2, "multiple chunks");
    assert.equal(r.canonChunks[1]!.id, "chunk_c", "chunk_c kept");

    r = filterCanonBySelection(canonChunks, canonScenes, ["nonexistent"]);
    assert.deepEqual(r.canonChunks, [], "no match → empty");

    r = filterCanonBySelection([], [], ["chunk_a"]);
    assert.deepEqual(r.canonChunks, [], "empty canon → empty");

    const scenesWithFacts = [sceneWithFacts] as unknown as Parameters<typeof filterCanonBySelection>[1];
    r = filterCanonBySelection([], scenesWithFacts, [], [canonFactCandidateId("scene_a", 2)]);
    assert.equal(r.canonChunks.length, 0, "no chunks");
    assert.equal(r.canonScenes.length, 1, "scene kept");
    assert.equal(r.canonScenes[0]!.facts.length, 1, "only selected fact");
    assert.equal(r.canonScenes[0]!.facts[0]!.textForm, "E loves F.", "correct fact");

    const scenesAB = [{ sceneId: "scene_a", arcKey: "a", chapterId: "ch1", episodeId: "ep1", chapterName: "Ch1", episodeLabel: "Ep1", sceneTitle: null, sceneSummary: null, units: [], facts: [{ subject: "A", predicate: "is", object: "B", textForm: "A is B." }], rankScore: 0.9, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } }, { sceneId: "scene_b", arcKey: "a", chapterId: "ch1", episodeId: "ep1", chapterName: "Ch1", episodeLabel: "Ep1", sceneTitle: null, sceneSummary: null, units: [], facts: [{ subject: "X", predicate: "likes", object: "Y", textForm: "X likes Y." }], rankScore: 0.8, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } }] as unknown as Parameters<typeof filterCanonBySelection>[1];
    r = filterCanonBySelection([], scenesAB, [], [canonFactCandidateId("scene_a", 0), canonFactCandidateId("scene_b", 0)]);
    assert.equal(r.canonScenes.length, 2, "multi-scene facts kept");

    const simpleScene = [{ sceneId: "scene_a", arcKey: "a", chapterId: "ch1", episodeId: "ep1", chapterName: "Ch1", episodeLabel: "Ep1", sceneTitle: null, sceneSummary: null, units: [], facts: [{ subject: "A", predicate: "is", object: "B", textForm: "A is B." }], rankScore: 0.9, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } }] as unknown as Parameters<typeof filterCanonBySelection>[1];
    r = filterCanonBySelection(canonChunks, simpleScene, ["chunk_a"], []);
    assert.equal(r.canonChunks.length, 1, "chunks kept when no fact selection");
    assert.equal(r.canonScenes.length, 0, "scenes cleared when only chunks selected");

    const mixedScene = [{ sceneId: "scene_a", arcKey: "a", chapterId: "ch1", episodeId: "ep1", chapterName: "Ch1", episodeLabel: "Ep1", sceneTitle: null, sceneSummary: null, units: [], facts: [{ subject: "A", predicate: "is", object: "B", textForm: "A is B." }, { subject: "C", predicate: "has", object: "D", textForm: "C has D." }], rankScore: 0.9, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } }] as unknown as Parameters<typeof filterCanonBySelection>[1];
    r = filterCanonBySelection(canonChunks, mixedScene, ["chunk_a"], [canonFactCandidateId("scene_a", 1)]);
    assert.equal(r.canonChunks.length, 1, "chunks kept with mixed");
    assert.equal(r.canonScenes.length, 1, "scene kept with mixed");
    assert.equal(r.canonScenes[0]!.facts.length, 1, "selected fact only");
    assert.equal(r.canonScenes[0]!.facts[0]!.textForm, "C has D.", "correct");
  });
});

describe("buildPromptContextCandidates canon_fact", () => {
  const baseScene = (overrides?: Partial<RetrievedCanonScene>) => ({ sceneId: overrides?.sceneId ?? "scene_1", arcKey: "a", chapterId: "ch1", episodeId: "ep1", chapterName: "Ch1", episodeLabel: "Ep1", episodeSummary: null, episodeOpeningUnits: [], sceneTitle: null, sceneSummary: null, units: [], facts: overrides?.facts ?? [], rankScore: overrides?.rankScore ?? 0.5, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } });

  it("builds, caps, and skips canon_fact candidates, reports diagnostics", () => {
    const facts = [{ subject: "A", predicate: "is", object: "B", textForm: "A is B." }, { subject: "C", predicate: "has", object: "D", textForm: "C has D." }];
    let r = buildPromptContextCandidates({ memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], canonChunks: [], canonScenes: [baseScene({ facts }) as any], recentTurns: [], sessionSummaryText: undefined });
    let candidates = r.candidates.filter((c) => c.source === "canon_fact");
    assert.equal(candidates.length, 2, "2 fact candidates");
    assert.equal(candidates[0]!.text, "A is B.", "first fact text");

    const manyFacts = Array.from({ length: 10 }, (_, i) => ({ subject: `S${i}`, predicate: "is", object: `O${i}`, textForm: `S${i} is O${i}.` }));
    r = buildPromptContextCandidates({ memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], canonChunks: [], canonScenes: [baseScene({ facts: manyFacts }) as any], recentTurns: [], sessionSummaryText: undefined });
    candidates = r.candidates.filter((c) => c.source === "canon_fact");
    assert.ok(candidates.length <= 6, "capped at 6");

    const blankFacts = [{ subject: "A", predicate: "is", object: "B", textForm: "" }, { subject: "C", predicate: "has", object: "D", textForm: "C has D." }];
    r = buildPromptContextCandidates({ memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], canonChunks: [], canonScenes: [baseScene({ facts: blankFacts }) as any], recentTurns: [], sessionSummaryText: undefined });
    candidates = r.candidates.filter((c) => c.source === "canon_fact");
    assert.equal(candidates.length, 1, "blank textForm skipped");

    r = buildPromptContextCandidates({ memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], canonChunks: [], canonScenes: [baseScene({ facts: [{ subject: "A", predicate: "is", object: "B", textForm: "A is B." }] }) as any], recentTurns: [], sessionSummaryText: undefined });
    assert.equal(r.diagnostics.countsBySource["canon_fact"], 1, "diagnostics count");
  });
});

describe("buildPromptContextCandidates maxCandidates cap", () => {
  const entries = Array.from({ length: 10 }, (_, i) => ({ id: `entry_${i}`, text: `entry ${i}`, summaryText: `entry ${i}`, finalScore: 0.5, cosineSimilarity: 0.5, turnIndex: i, entryType: "event" as const, sourceTurnIndex: i, turnStart: i, turnEnd: i, chunkType: "event" as const, chunkText: `entry ${i}`, textContent: `entry ${i}`, canonPriority: 0.5, contentType: "narrative" as const, speaker: null, rankScore: 0.5 })) as any;
  const memories = Array.from({ length: 10 }, (_, i) => ({ id: `mem_${i}`, summary: `memory ${i}`, cosineSimilarity: 0.5, importanceScore: 0.5, emotionScore: 0.5 })) as any;
  const openThreads = Array.from({ length: 8 }, (_, i) => ({ id: `ot_${i}`, source: "session_summary" as const, text: `thread ${i}`, status: "open" as const, sourceTurnIndex: i, score: 0.5 })) as any;

  it("default cap 24, honors maxCandidates, reports truncatedByTotalCap", () => {
    let r = buildPromptContextCandidates({ memories, sessionRecall: entries, structMemEntries: entries, structMemConsolidations: entries, openThreads, canonChunks: entries, recentTurns: [], sessionSummaryText: "summary", latestTurnDeltaText: "delta", memoryCorrections: [{ sourceTurnIndex: 0, oldClaim: "wrong", correctedClaim: "right" }, { sourceTurnIndex: 1, oldClaim: "old", correctedClaim: "new" }, { sourceTurnIndex: 2, oldClaim: "bad", correctedClaim: "good" }], motifProbeText: "probe" });
    assert.equal(r.candidates.length, 24, "cap at 24");
    assert.ok(r.diagnostics.truncatedByTotalCap > 0, "truncation reported");

    r = buildPromptContextCandidates({ memories, sessionRecall: entries, structMemEntries: entries, structMemConsolidations: entries, openThreads, canonChunks: entries, recentTurns: [], sessionSummaryText: "summary", latestTurnDeltaText: "delta", memoryCorrections: [{ sourceTurnIndex: 0, oldClaim: "wrong", correctedClaim: "right" }, { sourceTurnIndex: 1, oldClaim: "old", correctedClaim: "new" }], motifProbeText: "probe", maxCandidates: 10 });
    assert.equal(r.candidates.length, 10, "maxCandidates=10");
    assert.ok(r.diagnostics.truncatedByTotalCap > 0);

    r = buildPromptContextCandidates({ memories, sessionRecall: entries, structMemEntries: entries, structMemConsolidations: [], openThreads: [], canonChunks: [], recentTurns: [], sessionSummaryText: "summary", maxCandidates: 5 });
    assert.ok(r.candidates.length <= 5, "tight cap honored");
    assert.ok(r.diagnostics.truncatedByTotalCap > 0);
  });
});

describe("buildPromptContextCandidates internal_logic_evidence", () => {
  const evidenceHits = [{ id: "ev_001", characterId: "zuo_ran", node: "core_fear", claimText: "左然害怕暴露不成熟的一面。", evidenceText: "六年级生日想要棉花糖却说要钢笔。", arcKey: null, chapterKey: null, episodeLabel: null, sceneOrder: null, unitIndex: null, scopeApplicability: { continuityFamily: "main_world" }, sourceKind: "canon", confidenceScore: 0.9, metadata: {}, cosineSimilarity: 0.5, finalScore: 0.5 + 0.9 * 0.05 }, { id: "ev_002", characterId: "zuo_ran", node: "core_motivation", claimText: "行动先于语言的预判式浪漫。", evidenceText: "出差会在行李箱留出空间放礼物。", arcKey: null, chapterKey: null, episodeLabel: null, sceneOrder: null, unitIndex: null, scopeApplicability: { continuityFamily: "main_world" }, sourceKind: "canon", confidenceScore: null, metadata: {}, cosineSimilarity: 0.4, finalScore: 0.4 }, { id: "ev_003", characterId: "zuo_ran", node: "growth_environment", claimText: "温暖但严格的家庭。", evidenceText: "母亲做糖醋里脊时偷吃会被数落。", arcKey: null, chapterKey: null, episodeLabel: null, sceneOrder: null, unitIndex: null, scopeApplicability: { continuityFamily: "main_world" }, sourceKind: "canon", confidenceScore: null, metadata: {}, cosineSimilarity: 0.3, finalScore: 0.3 }];

  it("creates evidence candidates with stable IDs, text, and source cap", () => {
    let r = buildPromptContextCandidates({ memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], canonChunks: [], recentTurns: [], internalLogicEvidence: evidenceHits as any });
    let candidates = r.candidates.filter((c) => c.source === "internal_logic_evidence");
    assert.equal(candidates.length, 3, "3 evidence candidates");
    assert.equal(candidates[0]!.id, "internal_logic_evidence_ev_001", "stable ID");
    assert.equal(candidates[1]!.id, "internal_logic_evidence_ev_002", "stable ID");

    const singleEvidence = buildPromptContextCandidates({ memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], canonChunks: [], recentTurns: [], internalLogicEvidence: [evidenceHits[0]!] as any });
    const single = singleEvidence.candidates.find((c) => c.source === "internal_logic_evidence");
    assert.ok(single, "evidence candidate exists");
    assert.ok(single!.text.includes("[core_fear]"), "contains node");
    assert.ok(single!.text.includes("左然害怕暴露不成熟的一面"), "contains claimText");
    assert.ok(single!.text.includes("六年级生日想要棉花糖却说要钢笔"), "contains evidenceText");

    const manyHits = Array.from({ length: 6 }, (_, i) => ({ id: `ev_${i}`, characterId: "zuo_ran", node: "core_fear", claimText: `Claim ${i}`, evidenceText: `Evidence ${i}`, arcKey: null, chapterKey: null, episodeLabel: null, sceneOrder: null, unitIndex: null, scopeApplicability: {}, sourceKind: "canon", confidenceScore: null, metadata: {}, cosineSimilarity: 0.5 - i * 0.05, finalScore: 0.5 - i * 0.05 }));
    r = buildPromptContextCandidates({ memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], canonChunks: [], recentTurns: [], internalLogicEvidence: manyHits as any });
    candidates = r.candidates.filter((c) => c.source === "internal_logic_evidence");
    assert.equal(candidates.length, 4, "capped at SOURCE_CAPS=4");
  });
});

describe("applyCandidateSelection internal_logic_evidence", () => {
  const evidenceHits: any[] = [{ id: "ev_001", characterId: "zuo_ran", node: "core_fear", claimText: "Claim 1", evidenceText: "Evidence 1", arcKey: null, chapterKey: null, episodeLabel: null, sceneOrder: null, unitIndex: null, scopeApplicability: {}, sourceKind: "canon", confidenceScore: null, metadata: {}, cosineSimilarity: 0.5, finalScore: 0.5 }, { id: "ev_002", characterId: "zuo_ran", node: "core_motivation", claimText: "Claim 2", evidenceText: "Evidence 2", arcKey: null, chapterKey: null, episodeLabel: null, sceneOrder: null, unitIndex: null, scopeApplicability: {}, sourceKind: "canon", confidenceScore: null, metadata: {}, cosineSimilarity: 0.4, finalScore: 0.4 }];

  it("maps selected evidence IDs, excludes unselected, handles absent input", () => {
    let r = applyCandidateSelection({ shortlist: [makeCandidate("internal_logic_evidence_ev_001", "internal_logic_evidence"), makeCandidate("internal_logic_evidence_ev_002", "internal_logic_evidence"), makeCandidate("session_summary", "session_summary")], selectedIds: ["internal_logic_evidence_ev_001", "session_summary"], memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], internalLogicEvidence: evidenceHits });
    assert.equal(r.internalLogicEvidence.length, 1, "selected 1");
    assert.equal(r.internalLogicEvidence[0]!.id, "ev_001", "ev_001 mapped");
    assert.equal(r.internalLogicEvidence[0]!.node, "core_fear", "node preserved");

    r = applyCandidateSelection({ shortlist: [makeCandidate("internal_logic_evidence_ev_001", "internal_logic_evidence"), makeCandidate("internal_logic_evidence_ev_002", "internal_logic_evidence")], selectedIds: ["internal_logic_evidence_ev_002"], memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], internalLogicEvidence: evidenceHits });
    assert.equal(r.internalLogicEvidence.length, 1, "only ev_002");
    assert.equal(r.internalLogicEvidence[0]!.id, "ev_002", "unselected excluded");

    r = applyCandidateSelection({ shortlist: [makeCandidate("internal_logic_evidence_ev_001", "internal_logic_evidence"), makeCandidate("internal_logic_evidence_ev_002", "internal_logic_evidence"), makeCandidate("session_summary", "session_summary")], selectedIds: ["session_summary"], memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], internalLogicEvidence: evidenceHits });
    assert.equal(r.internalLogicEvidence.length, 0, "none selected");

    r = applyCandidateSelection({ shortlist: [makeCandidate("session_summary", "session_summary")], selectedIds: ["session_summary"], memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [] });
    assert.deepEqual(r.internalLogicEvidence, [], "no evidence input");
  });
});

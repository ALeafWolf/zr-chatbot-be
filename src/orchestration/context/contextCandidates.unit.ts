import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextCandidate } from "./contextCandidates";
import type { RetrievedCanonScene } from "../../retrieval/canon/retrieveCanonTier3Pipeline";
import { applyCandidateSelection, filterCanonBySelection, buildPromptContextCandidates, canonFactCandidateId } from "./contextCandidates";

function makeCandidate(id: string, source: string, extra?: Partial<ContextCandidate>): ContextCandidate {
  return {
    id,
    source: source as ContextCandidate["source"],
    text: extra?.text ?? `candidate ${id}`,
    score: extra?.score ?? 0.5,
    turnStart: extra?.turnStart ?? null,
    turnEnd: extra?.turnEnd ?? null,
  };
}

describe("applyCandidateSelection singleton sources", () => {
  it("sessionSummarySelected is true when session_summary is selected", () => {
    const result = applyCandidateSelection({
      shortlist: [
        makeCandidate("session_summary", "session_summary"),
        makeCandidate("latest_turn_delta", "latest_turn_delta"),
      ],
      selectedIds: ["session_summary"],
      memories: [],
      sessionRecall: [],
      structMemEntries: [],
      structMemConsolidations: [],
      openThreads: [],
    });
    assert.equal(result.sessionSummarySelected, true);
    assert.equal(result.latestTurnDeltaSelected, false);
  });

  it("latestTurnDeltaSelected is true when latest_turn_delta is selected", () => {
    const result = applyCandidateSelection({
      shortlist: [
        makeCandidate("session_summary", "session_summary"),
        makeCandidate("latest_turn_delta", "latest_turn_delta"),
      ],
      selectedIds: ["latest_turn_delta"],
      memories: [],
      sessionRecall: [],
      structMemEntries: [],
      structMemConsolidations: [],
      openThreads: [],
    });
    assert.equal(result.latestTurnDeltaSelected, true);
    assert.equal(result.sessionSummarySelected, false);
  });

  it("both false when selectedIds is empty", () => {
    const result = applyCandidateSelection({
      shortlist: [
        makeCandidate("session_summary", "session_summary"),
        makeCandidate("latest_turn_delta", "latest_turn_delta"),
      ],
      selectedIds: [],
      memories: [],
      sessionRecall: [],
      structMemEntries: [],
      structMemConsolidations: [],
      openThreads: [],
    });
    assert.equal(result.sessionSummarySelected, false);
    assert.equal(result.latestTurnDeltaSelected, false);
  });

  it("selectedCorrectionIds includes selected correction IDs", () => {
    const result = applyCandidateSelection({
      shortlist: [
        makeCandidate("correction_2", "memory_correction"),
        makeCandidate("correction_5", "memory_correction"),
        makeCandidate("correction_8", "memory_correction"),
      ],
      selectedIds: ["correction_2", "correction_8"],
      memories: [],
      sessionRecall: [],
      structMemEntries: [],
      structMemConsolidations: [],
      openThreads: [],
    });
    assert.deepEqual(result.selectedCorrectionIds, ["correction_2", "correction_8"]);
  });

  it("selectedCorrectionIds is empty when no corrections are selected", () => {
    const result = applyCandidateSelection({
      shortlist: [
        makeCandidate("correction_2", "memory_correction"),
      ],
      selectedIds: [],
      memories: [],
      sessionRecall: [],
      structMemEntries: [],
      structMemConsolidations: [],
      openThreads: [],
    });
    assert.deepEqual(result.selectedCorrectionIds, []);
  });

  it("sessionRecall filters by selected IDs, excluding unselected chunks", () => {
    const result = applyCandidateSelection({
      shortlist: [
        makeCandidate("chunk_a", "session_chunk"),
        makeCandidate("chunk_b", "session_chunk"),
      ],
      selectedIds: ["chunk_a"],
      memories: [],
      sessionRecall: [
        { id: "chunk_a", chunkText: "selected chunk text", turnStart: 1, turnEnd: 2, finalScore: 0.9, cosineSimilarity: 0.8, chunkType: "scene" },
        { id: "chunk_b", chunkText: "unselected chunk text that must be filtered out", turnStart: 3, turnEnd: 4, finalScore: 0.7, cosineSimilarity: 0.6, chunkType: "scene" },
      ] as any,
      structMemEntries: [],
      structMemConsolidations: [],
      openThreads: [],
    });
    assert.equal(result.sessionRecall.length, 1, "only the selected chunk should remain");
    assert.equal(result.sessionRecall[0]!.id, "chunk_a", "selected chunk id should be chunk_a");
  });

  it("openThreads are filtered by selected IDs", () => {
    const result = applyCandidateSelection({
      shortlist: [
        makeCandidate("ot1", "open_thread"),
        makeCandidate("ot2", "open_thread"),
      ],
      selectedIds: ["ot1"],
      memories: [],
      sessionRecall: [],
      structMemEntries: [],
      structMemConsolidations: [],
      openThreads: [
        { id: "ot1", source: "session_summary", text: "thread 1", status: "open", sourceTurnIndex: 0, score: 0.9 },
        { id: "ot2", source: "session_summary", text: "thread 2", status: "open", sourceTurnIndex: 1, score: 0.8 },
      ],
    });
    assert.equal(result.openThreads.length, 1);
    assert.equal(result.openThreads[0]!.id, "ot1");
  });
});

describe("filterCanonBySelection", () => {
  const canonChunks = [
    { id: "chunk_a", sceneId: "scene_1", textContent: "alpha", contentType: "narrative", arcKey: "a", chapterName: "" },
    { id: "chunk_b", sceneId: "scene_1", textContent: "beta", contentType: "narrative", arcKey: "a", chapterName: "" },
    { id: "chunk_c", sceneId: "scene_2", textContent: "gamma", contentType: "narrative", arcKey: "b", chapterName: "" },
  ] as Parameters<typeof filterCanonBySelection>[0];
  const canonScenes = [
    { sceneId: "scene_1", arcKey: "a", chapterId: "ch1", episodeId: "ep1", chapterName: "Ch1", episodeLabel: "Ep1", sceneTitle: null, sceneSummary: null, units: [], facts: [], rankScore: 0.5, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } },
    { sceneId: "scene_2", arcKey: "b", chapterId: "ch2", episodeId: "ep2", chapterName: "Ch2", episodeLabel: "Ep2", sceneTitle: null, sceneSummary: null, units: [], facts: [], rankScore: 0.4, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } },
  ] as unknown as Parameters<typeof filterCanonBySelection>[1];

  it("returns empty canon when selected IDs is empty", () => {
    const result = filterCanonBySelection(canonChunks, canonScenes, []);
    assert.deepEqual(result.canonChunks, []);
    assert.deepEqual(result.canonScenes, []);
  });

  it("keeps only matching chunks and clears scenes when some canon is selected", () => {
    const result = filterCanonBySelection(canonChunks, canonScenes, ["chunk_a"]);
    assert.equal(result.canonChunks.length, 1);
    assert.equal(result.canonChunks[0]!.id, "chunk_a");
    assert.deepEqual(result.canonScenes, [], "scenes are cleared to prevent re-expansion");
  });

  it("keeps multiple selected chunks and clears scenes", () => {
    const result = filterCanonBySelection(canonChunks, canonScenes, ["chunk_a", "chunk_c"]);
    assert.equal(result.canonChunks.length, 2);
    assert.deepEqual(
      result.canonChunks.map((c) => c.id).sort(),
      ["chunk_a", "chunk_c"],
    );
    assert.deepEqual(result.canonScenes, []);
  });

  it("returns empty canon when no chunk IDs match", () => {
    const result = filterCanonBySelection(canonChunks, canonScenes, ["nonexistent"]);
    assert.deepEqual(result.canonChunks, []);
    assert.deepEqual(result.canonScenes, []);
  });

  it("handles empty retrieved canon gracefully", () => {
    const result = filterCanonBySelection([], [], ["chunk_a"]);
    assert.deepEqual(result.canonChunks, []);
    assert.deepEqual(result.canonScenes, []);
  });

  it("keeps fact-parent scenes with only selected facts (facts-only selection)", () => {
    const scenes = [
      { sceneId: "scene_a", arcKey: "a", chapterId: "ch1", episodeId: "ep1", chapterName: "Ch1", episodeLabel: "Ep1", sceneTitle: null, sceneSummary: null, units: [], facts: [
        { subject: "A", predicate: "is", object: "B", textForm: "A is B." },
        { subject: "C", predicate: "has", object: "D", textForm: "C has D." },
        { subject: "E", predicate: "loves", object: "F", textForm: "E loves F." },
      ], rankScore: 0.9, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } },
    ] as unknown as Parameters<typeof filterCanonBySelection>[1];
    // Select only fact at original index 2 (non-zero index!)
    const result = filterCanonBySelection([], scenes, [], [canonFactCandidateId("scene_a", 2)]);
    assert.equal(result.canonChunks.length, 0, "no chunks should be returned");
    assert.equal(result.canonScenes.length, 1, "scene should be kept");
    assert.equal(result.canonScenes[0]!.facts.length, 1, "only the selected fact should remain");
    assert.equal(result.canonScenes[0]!.facts[0]!.textForm, "E loves F.");
  });

  it("keeps multiple selected facts across scenes (facts-only selection)", () => {
    const scenes = [
      { sceneId: "scene_a", arcKey: "a", chapterId: "ch1", episodeId: "ep1", chapterName: "Ch1", episodeLabel: "Ep1", sceneTitle: null, sceneSummary: null, units: [], facts: [
        { subject: "A", predicate: "is", object: "B", textForm: "A is B." },
      ], rankScore: 0.9, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } },
      { sceneId: "scene_b", arcKey: "a", chapterId: "ch1", episodeId: "ep1", chapterName: "Ch1", episodeLabel: "Ep1", sceneTitle: null, sceneSummary: null, units: [], facts: [
        { subject: "X", predicate: "likes", object: "Y", textForm: "X likes Y." },
      ], rankScore: 0.8, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } },
    ] as unknown as Parameters<typeof filterCanonBySelection>[1];
    const result = filterCanonBySelection([], scenes, [], [
      canonFactCandidateId("scene_a", 0),
      canonFactCandidateId("scene_b", 0),
    ]);
    assert.equal(result.canonScenes.length, 2);
    assert.equal(result.canonScenes[0]!.facts.length, 1);
    assert.equal(result.canonScenes[1]!.facts.length, 1);
  });

  it("clears scenes when only chunks are selected (existing behavior preserved)", () => {
    const scenes = [
      { sceneId: "scene_a", arcKey: "a", chapterId: "ch1", episodeId: "ep1", chapterName: "Ch1", episodeLabel: "Ep1", sceneTitle: null, sceneSummary: null, units: [], facts: [{ subject: "A", predicate: "is", object: "B", textForm: "A is B." }], rankScore: 0.9, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } },
    ] as unknown as Parameters<typeof filterCanonBySelection>[1];
    const result = filterCanonBySelection(canonChunks, scenes, ["chunk_a"], []);
    assert.equal(result.canonChunks.length, 1, "chunks should be kept");
    assert.equal(result.canonScenes.length, 0, "scenes should be cleared");
  });

  it("keeps both chunks and fact-scenes when both are selected", () => {
    const scenes = [
      { sceneId: "scene_a", arcKey: "a", chapterId: "ch1", episodeId: "ep1", chapterName: "Ch1", episodeLabel: "Ep1", sceneTitle: null, sceneSummary: null, units: [], facts: [
        { subject: "A", predicate: "is", object: "B", textForm: "A is B." },
        { subject: "C", predicate: "has", object: "D", textForm: "C has D." },
      ], rankScore: 0.9, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } },
    ] as unknown as Parameters<typeof filterCanonBySelection>[1];
    const result = filterCanonBySelection(canonChunks, scenes, ["chunk_a"], [canonFactCandidateId("scene_a", 1)]);
    assert.equal(result.canonChunks.length, 1, "chunks should be kept");
    assert.equal(result.canonScenes.length, 1, "scene should be kept");
    assert.equal(result.canonScenes[0]!.facts.length, 1, "only selected fact should remain");
    assert.equal(result.canonScenes[0]!.facts[0]!.textForm, "C has D.");
  });
});

describe("buildPromptContextCandidates canon_fact candidates", () => {
  const baseScene = (overrides?: Partial<RetrievedCanonScene>) => ({
    sceneId: overrides?.sceneId ?? "scene_1",
    arcKey: "a",
    chapterId: "ch1",
    episodeId: "ep1",
    chapterName: "Ch1",
    episodeLabel: "Ep1",
    episodeSummary: null,
    episodeOpeningUnits: [],
    sceneTitle: null,
    sceneSummary: null,
    units: [],
    facts: overrides?.facts ?? [],
    rankScore: overrides?.rankScore ?? 0.5,
    provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null },
  });

  it("builds canon_fact candidates from scene facts", () => {
    const result = buildPromptContextCandidates({
      memories: [],
      sessionRecall: [],
      structMemEntries: [],
      structMemConsolidations: [],
      openThreads: [],
      canonChunks: [],
      canonScenes: [baseScene({ facts: [
        { subject: "A", predicate: "is", object: "B", textForm: "A is B." },
        { subject: "C", predicate: "has", object: "D", textForm: "C has D." },
      ] })],
      recentTurns: [],
      sessionSummaryText: undefined,
    });
    const facts = result.candidates.filter((c) => c.source === "canon_fact");
    assert.equal(facts.length, 2, "should create two fact candidates");
    assert.equal(facts[0]!.id, canonFactCandidateId("scene_1", 0));
    assert.equal(facts[1]!.id, canonFactCandidateId("scene_1", 1));
    assert.equal(facts[0]!.text, "A is B.");
    assert.equal(facts[1]!.text, "C has D.");
  });

  it("caps canon_fact candidates to SOURCE_CAPS (6)", () => {
    const manyFacts = Array.from({ length: 10 }, (_, i) => ({
      subject: `S${i}`, predicate: "is", object: `O${i}`, textForm: `S${i} is O${i}.`,
    }));
    const result = buildPromptContextCandidates({
      memories: [],
      sessionRecall: [],
      structMemEntries: [],
      structMemConsolidations: [],
      openThreads: [],
      canonChunks: [],
      canonScenes: [baseScene({ facts: manyFacts })],
      recentTurns: [],
      sessionSummaryText: undefined,
    });
    const facts = result.candidates.filter((c) => c.source === "canon_fact");
    assert.ok(facts.length <= 6, `fact candidates should be capped at 6, got ${facts.length}`);
  });

  it("skips blank textForm facts", () => {
    const result = buildPromptContextCandidates({
      memories: [],
      sessionRecall: [],
      structMemEntries: [],
      structMemConsolidations: [],
      openThreads: [],
      canonChunks: [],
      canonScenes: [baseScene({ facts: [
        { subject: "A", predicate: "is", object: "B", textForm: "" },
        { subject: "C", predicate: "has", object: "D", textForm: "C has D." },
      ] })],
      recentTurns: [],
      sessionSummaryText: undefined,
    });
    const facts = result.candidates.filter((c) => c.source === "canon_fact");
    assert.equal(facts.length, 1);
    assert.equal(facts[0]!.text, "C has D.");
  });

  it("reports canon_fact counts in diagnostics retrievedBySource", () => {
    const result = buildPromptContextCandidates({
      memories: [],
      sessionRecall: [],
      structMemEntries: [],
      structMemConsolidations: [],
      openThreads: [],
      canonChunks: [],
      canonScenes: [baseScene({ facts: [
        { subject: "A", predicate: "is", object: "B", textForm: "A is B." },
      ] })],
      recentTurns: [],
      sessionSummaryText: undefined,
    });
    assert.equal(result.diagnostics.countsBySource["canon_fact"], 1);
  });
});

describe("buildPromptContextCandidates maxCandidates cap", () => {
  // Generate enough candidates across multiple sources to exceed the
  // default TOTAL_CAP (24) and any injected cap used in these tests.
  // Caps per source (SOURCE_CAPS): structmem_entry=6, session_chunk=5,
  // open_thread=3, interactive_memory=4, canon_chunk=4,
  // structmem_consolidation=4, memory_correction=3, plus session_summary=1,
  // latest_turn_delta=1, motif_probe=3. Total possible = 34.
  const entries = Array.from({ length: 10 }, (_, i) => ({
    id: `entry_${i}`,
    text: `entry ${i}`,
    summaryText: `entry ${i}`,
    finalScore: 0.5,
    cosineSimilarity: 0.5,
    turnIndex: i,
    entryType: "event" as const,
    sourceTurnIndex: i,
    turnStart: i,
    turnEnd: i,
    chunkType: "event" as const,
    chunkText: `entry ${i}`,
    textContent: `entry ${i}`,
    canonPriority: 0.5,
    contentType: "narrative" as const,
    speaker: null,
    rankScore: 0.5,
  })) as any;

  const memories = Array.from({ length: 10 }, (_, i) => ({
    id: `mem_${i}`,
    summary: `memory ${i}`,
    cosineSimilarity: 0.5,
    importanceScore: 0.5,
    emotionScore: 0.5,
  })) as any;

  const openThreads = Array.from({ length: 8 }, (_, i) => ({
    id: `ot_${i}`,
    source: "session_summary" as const,
    text: `thread ${i}`,
    status: "open" as const,
    sourceTurnIndex: i,
    score: 0.5,
  })) as any;

  it("defaults to TOTAL_CAP (24) with enough candidates to exceed it", () => {
    const result = buildPromptContextCandidates({
      memories,
      sessionRecall: entries,
      structMemEntries: entries,
      structMemConsolidations: entries,
      openThreads,
      canonChunks: entries,
      recentTurns: [],
      sessionSummaryText: "A long session summary that should appear as a candidate.",
      latestTurnDeltaText: "Latest turn delta text for the shortlist.",
      memoryCorrections: [
        { sourceTurnIndex: 0, oldClaim: "wrong", correctedClaim: "right" },
        { sourceTurnIndex: 1, oldClaim: "old", correctedClaim: "new" },
        { sourceTurnIndex: 2, oldClaim: "bad", correctedClaim: "good" },
      ],
      motifProbeText: "matched motif term text from probe",
    });
    // With all sources populated the shortlist exceeds 24; the cap should
    // truncate to exactly 24.
    assert.equal(result.candidates.length, 24,
      `expected exactly 24 candidates (TOTAL_CAP), got ${result.candidates.length}`);
    assert.ok(
      result.diagnostics.truncatedByTotalCap > 0,
      "should report truncation when candidates exceed TOTAL_CAP",
    );
  });

  it("honors injected maxCandidates=10 with enough candidates to exceed it", () => {
    const result = buildPromptContextCandidates({
      memories,
      sessionRecall: entries,
      structMemEntries: entries,
      structMemConsolidations: entries,
      openThreads,
      canonChunks: entries,
      recentTurns: [],
      sessionSummaryText: "summary",
      latestTurnDeltaText: "delta",
      memoryCorrections: [
        { sourceTurnIndex: 0, oldClaim: "wrong", correctedClaim: "right" },
        { sourceTurnIndex: 1, oldClaim: "old", correctedClaim: "new" },
      ],
      motifProbeText: "probe",
      maxCandidates: 10,
    });
    assert.equal(result.candidates.length, 10,
      `expected exactly 10 candidates (maxCandidates=10), got ${result.candidates.length}`);
    assert.ok(
      result.diagnostics.truncatedByTotalCap > 0,
      "should report truncation when candidates exceed maxCandidates",
    );
  });

  it("reports truncatedByTotalCap when candidates exceed a tight cap", () => {
    const result = buildPromptContextCandidates({
      memories,
      sessionRecall: entries,
      structMemEntries: entries,
      structMemConsolidations: [],
      openThreads: [],
      canonChunks: [],
      recentTurns: [],
      sessionSummaryText: "summary",
      maxCandidates: 5,
    });
    assert.ok(result.diagnostics.truncatedByTotalCap > 0);
    assert.ok(result.candidates.length <= 5);
  });
});

// ---------------------------------------------------------------------------
// buildPromptContextCandidates — internal-logic evidence
// ---------------------------------------------------------------------------
describe("buildPromptContextCandidates internal_logic_evidence", () => {
  const evidenceHits = [
    {
      id: "ev_001",
      characterId: "zuo_ran",
      node: "core_fear",
      claimText: "左然害怕暴露不成熟的一面。",
      evidenceText: "六年级生日想要棉花糖却说要钢笔。",
      arcKey: null, chapterKey: null, episodeLabel: null,
      sceneOrder: null, unitIndex: null,
      scopeApplicability: { continuityFamily: "main_world" },
      sourceKind: "canon", confidenceScore: 0.9, metadata: {},
      cosineSimilarity: 0.5, finalScore: 0.5 + 0.9 * 0.05,
    },
    {
      id: "ev_002",
      characterId: "zuo_ran",
      node: "core_motivation",
      claimText: "行动先于语言的预判式浪漫。",
      evidenceText: "出差会在行李箱留出空间放礼物。",
      arcKey: null, chapterKey: null, episodeLabel: null,
      sceneOrder: null, unitIndex: null,
      scopeApplicability: { continuityFamily: "main_world" },
      sourceKind: "canon", confidenceScore: null, metadata: {},
      cosineSimilarity: 0.4, finalScore: 0.4,
    },
    {
      id: "ev_003",
      characterId: "zuo_ran",
      node: "growth_environment",
      claimText: "温暖但严格的家庭。",
      evidenceText: "母亲做糖醋里脊时偷吃会被数落。",
      arcKey: null, chapterKey: null, episodeLabel: null,
      sceneOrder: null, unitIndex: null,
      scopeApplicability: { continuityFamily: "main_world" },
      sourceKind: "canon", confidenceScore: null, metadata: {},
      cosineSimilarity: 0.3, finalScore: 0.3,
    },
  ];

  it("creates internal_logic_evidence candidates with stable IDs and correct source", () => {
    const result = buildPromptContextCandidates({
      memories: [], sessionRecall: [], structMemEntries: [],
      structMemConsolidations: [], openThreads: [], canonChunks: [],
      recentTurns: [],
      internalLogicEvidence: evidenceHits as any,
    });
    const evidenceCandidates = result.candidates.filter(
      (c) => c.source === "internal_logic_evidence",
    );
    assert.equal(evidenceCandidates.length, 3);
    assert.equal(evidenceCandidates[0]!.id, "internal_logic_evidence_ev_001");
    assert.equal(evidenceCandidates[1]!.id, "internal_logic_evidence_ev_002");
    assert.equal(evidenceCandidates[2]!.id, "internal_logic_evidence_ev_003");
  });

  it("candidate text includes node, claim, and evidence text", () => {
    const result = buildPromptContextCandidates({
      memories: [], sessionRecall: [], structMemEntries: [],
      structMemConsolidations: [], openThreads: [], canonChunks: [],
      recentTurns: [],
      internalLogicEvidence: [evidenceHits[0]!] as any,
    });
    const candidate = result.candidates.find(
      (c) => c.source === "internal_logic_evidence",
    );
    assert.ok(candidate, "evidence candidate should exist");
    assert.ok(candidate!.text.includes("[core_fear]"), "text should contain node");
    assert.ok(candidate!.text.includes("左然害怕暴露不成熟的一面"), "text should contain claimText");
    assert.ok(candidate!.text.includes("六年级生日想要棉花糖却说要钢笔"), "text should contain evidenceText");
  });

  it("applies source cap for internal_logic_evidence (cap=4)", () => {
    // Create 6 hits, only 4 should appear due to the cap
    const manyHits = Array.from({ length: 6 }, (_, i) => ({
      id: `ev_${i}`,
      characterId: "zuo_ran", node: "core_fear",
      claimText: `Claim ${i}`, evidenceText: `Evidence ${i}`,
      arcKey: null, chapterKey: null, episodeLabel: null,
      sceneOrder: null, unitIndex: null,
      scopeApplicability: {}, sourceKind: "canon",
      confidenceScore: null, metadata: {},
      cosineSimilarity: 0.5 - i * 0.05, finalScore: 0.5 - i * 0.05,
    }));
    const result = buildPromptContextCandidates({
      memories: [], sessionRecall: [], structMemEntries: [],
      structMemConsolidations: [], openThreads: [], canonChunks: [],
      recentTurns: [],
      internalLogicEvidence: manyHits as any,
    });
    const evidenceCandidates = result.candidates.filter(
      (c) => c.source === "internal_logic_evidence",
    );
    assert.equal(evidenceCandidates.length, 4, "should cap at SOURCE_CAPS.internal_logic_evidence=4");
  });
});

// ---------------------------------------------------------------------------
// applyCandidateSelection — internal-logic evidence
// ---------------------------------------------------------------------------
describe("applyCandidateSelection internal_logic_evidence", () => {
  const evidenceHits = [
    {
      id: "ev_001", characterId: "zuo_ran", node: "core_fear",
      claimText: "Claim 1", evidenceText: "Evidence 1",
      arcKey: null, chapterKey: null, episodeLabel: null,
      sceneOrder: null, unitIndex: null,
      scopeApplicability: {}, sourceKind: "canon",
      confidenceScore: null, metadata: {},
      cosineSimilarity: 0.5, finalScore: 0.5,
    },
    {
      id: "ev_002", characterId: "zuo_ran", node: "core_motivation",
      claimText: "Claim 2", evidenceText: "Evidence 2",
      arcKey: null, chapterKey: null, episodeLabel: null,
      sceneOrder: null, unitIndex: null,
      scopeApplicability: {}, sourceKind: "canon",
      confidenceScore: null, metadata: {},
      cosineSimilarity: 0.4, finalScore: 0.4,
    },
  ] as any;

  it("maps selected evidence IDs back to typed InternalLogicEvidenceHit[]", () => {
    const result = applyCandidateSelection({
      shortlist: [
        makeCandidate("internal_logic_evidence_ev_001", "internal_logic_evidence"),
        makeCandidate("internal_logic_evidence_ev_002", "internal_logic_evidence"),
        makeCandidate("session_summary", "session_summary"),
      ],
      selectedIds: ["internal_logic_evidence_ev_001", "session_summary"],
      memories: [],
      sessionRecall: [],
      structMemEntries: [],
      structMemConsolidations: [],
      openThreads: [],
      internalLogicEvidence: evidenceHits,
    });
    assert.equal(result.internalLogicEvidence.length, 1, "should select 1 evidence hit");
    assert.equal(result.internalLogicEvidence[0]!.id, "ev_001", "should map ev_001");
    assert.equal(result.internalLogicEvidence[0]!.node, "core_fear");
  });

  it("unselected evidence is excluded from typed array", () => {
    const result = applyCandidateSelection({
      shortlist: [
        makeCandidate("internal_logic_evidence_ev_001", "internal_logic_evidence"),
        makeCandidate("internal_logic_evidence_ev_002", "internal_logic_evidence"),
      ],
      selectedIds: ["internal_logic_evidence_ev_002"], // only ev_002 selected
      memories: [],
      sessionRecall: [],
      structMemEntries: [],
      structMemConsolidations: [],
      openThreads: [],
      internalLogicEvidence: evidenceHits,
    });
    assert.equal(result.internalLogicEvidence.length, 1, "should select only 1");
    assert.equal(result.internalLogicEvidence[0]!.id, "ev_002", "unselected ev_001 should be excluded");
  });

  it("returns empty array when no evidence is selected", () => {
    const result = applyCandidateSelection({
      shortlist: [
        makeCandidate("internal_logic_evidence_ev_001", "internal_logic_evidence"),
        makeCandidate("internal_logic_evidence_ev_002", "internal_logic_evidence"),
        makeCandidate("session_summary", "session_summary"),
      ],
      selectedIds: ["session_summary"],
      memories: [],
      sessionRecall: [],
      structMemEntries: [],
      structMemConsolidations: [],
      openThreads: [],
      internalLogicEvidence: evidenceHits,
    });
    assert.equal(result.internalLogicEvidence.length, 0, "no evidence selected");
  });

  it("returns empty array when no evidence was provided as input", () => {
    const result = applyCandidateSelection({
      shortlist: [makeCandidate("session_summary", "session_summary")],
      selectedIds: ["session_summary"],
      memories: [],
      sessionRecall: [],
      structMemEntries: [],
      structMemConsolidations: [],
      openThreads: [],
    });
    assert.deepEqual(result.internalLogicEvidence, []);
  });
});

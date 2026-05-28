import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hybridScoreSelect } from "./hybridScoreRerank";
import type { ContextCandidate } from "./contextCandidates";

function makeCandidate(
  id: string,
  source: ContextCandidate["source"],
  score: number | null = 0.5,
): ContextCandidate {
  return { id, source, text: `text for ${id}`, score };
}

describe("hybridScoreSelect", () => {
  it("returns empty selection for empty candidates", () => {
    const { selected } = hybridScoreSelect([], "scene_continuation");
    assert.equal(selected.length, 0);
  });

  it("selects candidates sorted by source priority when scores are equal", () => {
    const candidates = [
      makeCandidate("canon_1", "canon_chunk", 0.8),
      makeCandidate("mem_1", "interactive_memory", 0.8),
      makeCandidate("sc_1", "session_chunk", 0.8),
    ];
    const { selected } = hybridScoreSelect(candidates, "scene_continuation");
    // session_chunk (priority 7) should come before interactive_memory (8) and canon_chunk (9)
    const indices = selected.map((c) => c.id);
    assert.equal(indices[0], "sc_1");
    assert.equal(indices[1], "mem_1");
    assert.equal(indices[2], "canon_1");
  });

  it("prefers higher score within same source priority", () => {
    const candidates = [
      makeCandidate("mem_low", "interactive_memory", 0.3),
      makeCandidate("mem_high", "interactive_memory", 0.9),
    ];
    const { selected } = hybridScoreSelect(candidates, "scene_continuation");
    assert.ok(selected.length >= 1);
    // Higher-scored item should appear first
    const highIdx = selected.findIndex((c) => c.id === "mem_high");
    const lowIdx = selected.findIndex((c) => c.id === "mem_low");
    assert.ok(highIdx < lowIdx, "higher-scored item should be selected before lower-scored item");
  });

  it("includes intent-required sources for explicit_recall", () => {
    const candidates = [
      makeCandidate("canon_1", "canon_chunk", 0.9),
      makeCandidate("mem_1", "interactive_memory", 0.5),
      makeCandidate("sc_1", "session_chunk", 0.5),
      makeCandidate("struct_1", "structmem_entry", 0.5),
    ];
    const { selected } = hybridScoreSelect(candidates, "explicit_recall");
    const selectedIds = selected.map((c) => c.id);
    // interactive_memory and structmem_entry should be selected (intent-required)
    assert.ok(selectedIds.includes("mem_1"), "interactive_memory should be selected for explicit_recall");
    assert.ok(selectedIds.includes("struct_1"), "structmem_entry should be selected for explicit_recall");
  });

  it("includes canon for canon_question intent", () => {
    const candidates = [
      makeCandidate("canon_1", "canon_chunk", 0.5),
      makeCandidate("mem_1", "interactive_memory", 0.9), // high score but not canon
    ];
    const { selected } = hybridScoreSelect(candidates, "canon_question");
    const selectedIds = selected.map((c) => c.id);
    assert.ok(selectedIds.includes("canon_1"), "canon should be selected for canon_question");
  });

  it("applies per-source caps", () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeCandidate(`struct_${i}`, "structmem_entry", 0.8),
    );
    const { selected } = hybridScoreSelect(candidates, "explicit_recall");
    // Cap for structmem_entry is 3
    const structCount = selected.filter((c) => c.source === "structmem_entry").length;
    assert.equal(structCount, 3);
  });

  it("applies total cap of 12", () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      makeCandidate(`sc_${i}`, "session_chunk", 0.8),
    );
    const { selected } = hybridScoreSelect(candidates, "scene_continuation");
    assert.ok(selected.length <= 12);
  });

  it("selects canon chunk for canon_question intent", () => {
    const candidates = [
      makeCandidate("canon_1", "canon_chunk", 0.8),
    ];
    const { selected } = hybridScoreSelect(candidates, "canon_question");
    assert.ok(selected.some((c) => c.source === "canon_chunk"));
  });

  it("selects canon_fact for canon_question intent", () => {
    const candidates = [
      makeCandidate("fact_1", "canon_fact", 0.8),
      makeCandidate("mem_1", "interactive_memory", 0.9),
    ];
    const { selected } = hybridScoreSelect(candidates, "canon_question");
    const factSelected = selected.some((c) => c.source === "canon_fact");
    assert.ok(factSelected, "canon_fact should be selected for canon_question");
  });

  it("selects internal_logic_evidence candidates when present", () => {
    const candidates = [
      makeCandidate("internal_logic_evidence_ev_001", "internal_logic_evidence", 0.7),
      makeCandidate("internal_logic_evidence_ev_002", "internal_logic_evidence", 0.6),
    ];
    const { selected } = hybridScoreSelect(candidates, "scene_continuation");
    const evidenceSelected = selected.filter((c) => c.source === "internal_logic_evidence");
    assert.equal(evidenceSelected.length, 2, "both evidence candidates should be selected");
    assert.equal(evidenceSelected[0]!.id, "internal_logic_evidence_ev_001");
  });

  it("applies hybrid source cap for internal_logic_evidence", () => {
    const candidates = Array.from({ length: 5 }, (_, i) =>
      makeCandidate(`internal_logic_evidence_ev_${i}`, "internal_logic_evidence", 0.5),
    );
    const { selected } = hybridScoreSelect(candidates, "scene_continuation");
    const evidenceSelected = selected.filter((c) => c.source === "internal_logic_evidence");
    // HYBRID_SOURCE_CAPS.internal_logic_evidence = 2
    assert.equal(evidenceSelected.length, 2, "should cap at HYBRID_SOURCE_CAPS of 2");
  });
});

import { runHybridScoreRerank } from "./hybridScoreRerank";
import type { RerankContextInput } from "./rerankContext";
import type { RetrievedMemory } from "../../retrieval/memory/retrieveInteractiveMemories";
import type { RetrievedSessionMemoryChunk } from "../../retrieval/memory/retrieveSessionMemoryChunks";
import type { RetrievedStructMemEntry } from "../../retrieval/memory/retrieveStructMemEntries";
import type { RetrievedStructMemConsolidation } from "../../retrieval/memory/retrieveStructMemConsolidations";
import type { RetrievedOpenThread } from "../../retrieval/memory/retrieveOpenThreads";
import type { RetrievedCanonChunk } from "../../retrieval/canon/retrieveCanonNarrative";
import type { RetrievedCanonScene } from "../../retrieval/canon/retrieveCanonTier3Pipeline";
import type { InternalLogicEvidenceHit } from "../../retrieval/internalLogic/searchInternalLogicEvidence";

function makeHybridInput(overrides: Partial<RerankContextInput> & { evidenceHits?: InternalLogicEvidenceHit[] }): RerankContextInput {
  return {
    userMessage: "hi",
    structuredUserQuery: { userSpeech: "hi" },
    plannerIntent: "scene_continuation",
    plannerHints: { sourcePriority: [], queryVariants: { memory: [], structmem: [], structmemConsolidation: [], interactiveMemory: [], canon: [], web: [] }, possibleMotif: false, possibleCanonClaim: false, possibleOldMemoryReference: false, possibleDurableMemoryReference: false },
    recentTurns: [],
    continuityScope: "main_married",
    candidates: [],
    memories: [] as RetrievedMemory[],
    sessionRecall: [] as RetrievedSessionMemoryChunk[],
    structMemEntries: [] as RetrievedStructMemEntry[],
    structMemConsolidations: [] as RetrievedStructMemConsolidation[],
    openThreads: [] as RetrievedOpenThread[],
    canonChunks: [] as RetrievedCanonChunk[],
    canonScenes: [] as RetrievedCanonScene[],
    sessionSummary: null as any,
    latestTurnDelta: null,
    memoryCorrections: [],
    retrievalPlan: { intent: "scene_continuation" as const, canonMode: "skip" as const, broadFailOpen: false, forceOpenThreads: false, durableMemoryTopK: 0, sessionRecallTopK: 0, structMemEntryTopK: 0, structMemConsolidationTopK: 0, openThreadTopK: 0, contextNeed: { needsRecentTurns: false, needsOlderSessionRecall: false, needsDurableMemory: false, needsStructMem: false, needsStructMemConsolidation: false, needsCanon: false, needsWeb: false, injectionMode: "compact" as const, reason: "" } },
    ...overrides,
    internalLogicEvidence: overrides.evidenceHits,
  };
}

describe("runHybridScoreRerank finalContextMode", () => {
  const evidenceHit: InternalLogicEvidenceHit = {
    id: "ev_001", characterId: "zuo_ran", node: "core_fear",
    claimText: "Claim", evidenceText: "Evidence",
    arcKey: null, chapterKey: null, episodeLabel: null,
    sceneOrder: null, unitIndex: null, scopeApplicability: {},
    sourceKind: "canon", confidenceScore: null, metadata: {},
    cosineSimilarity: 0.5, finalScore: 0.5,
  };

  it("evidence-only selection returns selected_memory mode and preserves evidence", async () => {
    const result = await runHybridScoreRerank(makeHybridInput({
      candidates: [makeCandidate("internal_logic_evidence_ev_001", "internal_logic_evidence")],
      evidenceHits: [evidenceHit],
    }));
    assert.equal(result.selectedContext.internalLogicEvidence?.length, 1);
    assert.equal(result.selectedContext.internalLogicEvidence![0]!.id, "ev_001");
    assert.equal(result.rerankOutput.finalContextMode, "selected_memory");
  });

  it("canon-only selection returns selected_canon mode", async () => {
    const result = await runHybridScoreRerank(makeHybridInput({
      candidates: [makeCandidate("canon_1", "canon_chunk")],
      canonChunks: [{ id: "canon_1", textContent: "canon", sceneId: "s1", arcKey: "a", chapterName: "ch", contentType: "narrative", speaker: null, canonPriority: null, rankScore: 0.5 } as RetrievedCanonChunk],
    }));
    assert.equal(result.rerankOutput.finalContextMode, "selected_canon");
  });

  it("canon plus evidence returns memory_and_canon mode", async () => {
    const result = await runHybridScoreRerank(makeHybridInput({
      candidates: [
        makeCandidate("canon_1", "canon_chunk"),
        makeCandidate("internal_logic_evidence_ev_001", "internal_logic_evidence"),
      ],
      canonChunks: [{ id: "canon_1", textContent: "canon", sceneId: "s1", arcKey: "a", chapterName: "ch", contentType: "narrative", speaker: null, canonPriority: null, rankScore: 0.5 } as RetrievedCanonChunk],
      evidenceHits: [evidenceHit],
    }));
    assert.equal(result.rerankOutput.finalContextMode, "memory_and_canon");
  });

  it("no selected candidates returns recent_only mode", async () => {
    const result = await runHybridScoreRerank(makeHybridInput({
      candidates: [],
    }));
    assert.equal(result.rerankOutput.finalContextMode, "recent_only");
  });

  it("diagnostics include internal_logic_evidence retrieved and injected counts", async () => {
    const result = await runHybridScoreRerank(makeHybridInput({
      candidates: [makeCandidate("internal_logic_evidence_ev_001", "internal_logic_evidence")],
      evidenceHits: [evidenceHit],
    }));
    const d = result.selectedContext.diagnostics;
    assert.equal((d.retrievedCounts as any).internal_logic_evidence, 1);
    assert.equal((d.injectedCounts as any).internal_logic_evidence, 1);
  });

  it("selected_memory mode with only evidence and no other memory sources", async () => {
    // Only evidence is selected, no other memory sources should still result in selected_memory
    const result = await runHybridScoreRerank(makeHybridInput({
      candidates: [makeCandidate("internal_logic_evidence_ev_001", "internal_logic_evidence")],
      evidenceHits: [evidenceHit],
      memories: [],
    }));
    assert.equal(result.rerankOutput.finalContextMode, "selected_memory");
  });
});

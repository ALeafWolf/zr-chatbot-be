import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextCandidate } from "./contextCandidates";
import { applyCandidateSelection, filterCanonBySelection } from "./contextCandidates";

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
  const canonScenes: Parameters<typeof filterCanonBySelection>[1] = [
    { sceneId: "scene_1", arcKey: "a", chapterId: "ch1", episodeId: "ep1", chapterName: "Ch1", episodeLabel: "Ep1", sceneTitle: null, sceneSummary: null, units: [], facts: [], rankScore: 0.5, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } },
    { sceneId: "scene_2", arcKey: "b", chapterId: "ch2", episodeId: "ep2", chapterName: "Ch2", episodeLabel: "Ep2", sceneTitle: null, sceneSummary: null, units: [], facts: [], rankScore: 0.4, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } },
  ];

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
});

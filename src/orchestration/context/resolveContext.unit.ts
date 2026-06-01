import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  preserveCriticalContext,
  tryRetrieveInternalLogicEvidence,
} from "./resolveContext";
import type { SessionSummaryRecord } from "../../memory/session/sessionSummaryRepo";
import type { LatestTurnDelta } from "../turn/turnDelta";
import type { MemoryCorrectionContext } from "./memoryCorrections";
import type { InternalLogicEvidenceHit } from "../../retrieval/internalLogic/searchInternalLogicEvidence";

describe("preserveCriticalContext", () => {
  const mockSummary: SessionSummaryRecord = {
    id: "sum_1",
    sessionId: "s1",
    characterId: "c1",
    playerId: "p1",
    lastSummarizedTurnIndex: 10,
    summaryJson: {},
    summaryText: "Session summary text",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockDelta: LatestTurnDelta = {
    kind: "latest_turn_delta",
    sourceTurnStart: 8,
    sourceTurnEnd: 9,
    expiresAfterTurn: 13,
    facts: ["fact 1"],
    pendingActions: ["action 1"],
    relationshipSignals: [],
  };

  const mockCorrections: MemoryCorrectionContext[] = [
    { sourceTurnIndex: 3, oldClaim: "wrong", correctedClaim: "right" },
    { sourceTurnIndex: 7, oldClaim: "old", correctedClaim: "new" },
  ];

  it("preserves session summary when present", () => {
    const result = preserveCriticalContext(mockSummary, null, []);
    assert.notEqual(result.filteredSessionSummary, null);
    assert.equal(result.filteredSessionSummary!.summaryText, "Session summary text");
  });

  it("preserves session summary as null when input is null", () => {
    const result = preserveCriticalContext(null, null, []);
    assert.equal(result.filteredSessionSummary, null);
  });

  it("preserves latest turn delta when present", () => {
    const result = preserveCriticalContext(null, mockDelta, []);
    assert.notEqual(result.filteredLatestTurnDelta, null);
    assert.equal(result.filteredLatestTurnDelta!.kind, "latest_turn_delta");
    assert.equal(result.filteredLatestTurnDelta!.sourceTurnStart, 8);
  });

  it("preserves latest turn delta as null when input is null", () => {
    const result = preserveCriticalContext(null, null, []);
    assert.equal(result.filteredLatestTurnDelta, null);
  });

  it("preserves all memory corrections", () => {
    const result = preserveCriticalContext(null, null, mockCorrections);
    assert.equal(result.filteredMemoryCorrections.length, 2);
    assert.equal(result.filteredMemoryCorrections[0]!.sourceTurnIndex, 3);
    assert.equal(result.filteredMemoryCorrections[1]!.sourceTurnIndex, 7);
  });

  it("preserves empty memory corrections array", () => {
    const result = preserveCriticalContext(null, null, []);
    assert.deepEqual(result.filteredMemoryCorrections, []);
  });

  it("preserves all three critical context items simultaneously", () => {
    const result = preserveCriticalContext(mockSummary, mockDelta, mockCorrections);

    assert.notEqual(result.filteredSessionSummary, null);
    assert.equal(result.filteredSessionSummary!.summaryText, "Session summary text");
    assert.notEqual(result.filteredLatestTurnDelta, null);
    assert.equal(result.filteredLatestTurnDelta!.sourceTurnStart, 8);
    assert.equal(result.filteredMemoryCorrections.length, 2);
  });

  it("preserves all context even when a hypothetical reranker selected none of them", () => {
    // This simulates the case where the LLM reranker returns selected IDs
    // but none of the control-context singleton IDs are in the selection.
    // The function must preserve all three regardless.
    const result = preserveCriticalContext(mockSummary, mockDelta, mockCorrections);

    assert.notEqual(result.filteredSessionSummary, null, "session summary must survive empty rerank selection");
    assert.notEqual(result.filteredLatestTurnDelta, null, "latest turn delta must survive empty rerank selection");
    assert.equal(result.filteredMemoryCorrections.length, 2, "memory corrections must survive empty rerank selection");
  });
});

// ---------------------------------------------------------------------------
// tryRetrieveInternalLogicEvidence
// ---------------------------------------------------------------------------

describe("tryRetrieveInternalLogicEvidence", () => {
  const args = {
    characterId: "zuo_ran",
    queryEmbedding: [0.1, 0.2, 0.3],
    continuityScope: "main_relationship",
    arcKeys: ["arc_1"],
  };

  const fakeHit: InternalLogicEvidenceHit = {
    id: "hit_1",
    characterId: "zuo_ran",
    node: "core_belief",
    claimText: "Claim text",
    evidenceText: "Evidence text",
    arcKey: "arc_1",
    chapterKey: null,
    episodeLabel: null,
    sceneOrder: null,
    unitIndex: null,
    scopeApplicability: {},
    sourceKind: "story_fact",
    confidenceScore: 0.9,
    metadata: {},
    cosineSimilarity: 0.85,
    finalScore: 0.85,
  };

  it("returns results from a successful search", async () => {
    let callCount = 0;
    const searchFn = async () => { callCount++; return [fakeHit]; };
    const results = await tryRetrieveInternalLogicEvidence(searchFn, args);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.id, "hit_1");
    assert.equal(callCount, 1);
  });

  it("returns empty array when search throws (error isolation)", async () => {
    let callCount = 0;
    const searchFn = async () => {
      callCount++;
      throw new Error("pgvector extension not available");
    };

    // Capture console.error output
    const stderr: string[] = [];
    const origError = console.error;
    console.error = (...msgs: unknown[]) => {
      stderr.push(msgs.map(String).join(" "));
    };

    try {
      const results = await tryRetrieveInternalLogicEvidence(searchFn, args);

      assert.equal(results.length, 0, "must degrade to empty array on throw");
      assert.equal(callCount, 1);

      // Verify the error was logged
      assert.ok(
        stderr.some((s) => s.includes("pgvector extension not available")),
        "error message must be logged",
      );
      assert.ok(
        stderr.some((s) => s.includes("continuing without evidence")),
        "fallback message must be logged",
      );
    } finally {
      console.error = origError;
    }
  });

  it("passes through empty results from a successful search", async () => {
    let callCount = 0;
    const searchFn = async () => { callCount++; return []; };
    const results = await tryRetrieveInternalLogicEvidence(searchFn, args);
    assert.equal(results.length, 0);
    assert.equal(callCount, 1);
  });

  it("delegates search function args correctly", async () => {
    let capturedArgs: unknown = null;
    const searchFn = async (a: unknown) => { capturedArgs = a; return [fakeHit]; };
    const results = await tryRetrieveInternalLogicEvidence(searchFn, args);
    assert.equal(results.length, 1);
    assert.equal(capturedArgs, args);
  });
});

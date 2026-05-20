import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { preserveCriticalContext } from "./resolveContext";
import type { SessionSummaryRecord } from "../../memory/session/sessionSummaryRepo";
import type { LatestTurnDelta } from "../turn/turnDelta";
import type { MemoryCorrectionContext } from "./memoryCorrections";

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

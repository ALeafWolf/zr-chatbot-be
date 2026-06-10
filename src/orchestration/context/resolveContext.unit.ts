import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { preserveCriticalContext, tryRetrieveInternalLogicEvidence } from "./resolveContext";
import type { SessionSummaryRecord } from "../../memory/session/sessionSummaryRepo";
import type { LatestTurnDelta } from "../turn/turnDelta";
import type { MemoryCorrectionContext } from "./memoryCorrections";
import type { InternalLogicEvidenceHit } from "../../retrieval/internalLogic/searchInternalLogicEvidence";

describe("preserveCriticalContext", () => {
  const mockSummary: SessionSummaryRecord = { id: "sum_1", sessionId: "s1", characterId: "c1", playerId: "p1", lastSummarizedTurnIndex: 10, summaryJson: {}, summaryText: "Session summary text", createdAt: new Date(), updatedAt: new Date() };
  const mockDelta: LatestTurnDelta = { kind: "latest_turn_delta", sourceTurnStart: 8, sourceTurnEnd: 9, expiresAfterTurn: 13, facts: ["fact 1"], pendingActions: ["action 1"], relationshipSignals: [] };
  const mockCorrections: MemoryCorrectionContext[] = [{ sourceTurnIndex: 3, oldClaim: "wrong", correctedClaim: "right" }, { sourceTurnIndex: 7, oldClaim: "old", correctedClaim: "new" }];

  it("preserves session summary, latest turn delta, and memory corrections", () => {
    let r = preserveCriticalContext(mockSummary, null, []);
    assert.notEqual(r.filteredSessionSummary, null, "summary present");
    assert.equal(r.filteredSessionSummary!.summaryText, "Session summary text", "summary text");

    r = preserveCriticalContext(null, null, []);
    assert.equal(r.filteredSessionSummary, null, "summary null when input null");

    r = preserveCriticalContext(null, mockDelta, []);
    assert.equal(r.filteredLatestTurnDelta!.kind, "latest_turn_delta", "delta present");
    assert.equal(r.filteredLatestTurnDelta!.sourceTurnStart, 8, "delta sourceTurnStart");

    r = preserveCriticalContext(null, null, []);
    assert.equal(r.filteredLatestTurnDelta, null, "delta null when input null");

    r = preserveCriticalContext(null, null, mockCorrections);
    assert.equal(r.filteredMemoryCorrections.length, 2, "corrections preserved");

    r = preserveCriticalContext(null, null, []);
    assert.deepEqual(r.filteredMemoryCorrections, [], "empty corrections");

    r = preserveCriticalContext(mockSummary, mockDelta, mockCorrections);
    assert.notEqual(r.filteredSessionSummary, null, "all three simultaneously");
    assert.notEqual(r.filteredLatestTurnDelta, null, "all three");
    assert.equal(r.filteredLatestTurnDelta!.sourceTurnStart, 8, "all three — sourceTurnStart");
    assert.equal(r.filteredMemoryCorrections.length, 2, "all three");
  });
});

describe("tryRetrieveInternalLogicEvidence", () => {
  const args = { characterId: "zuo_ran", queryEmbedding: [0.1, 0.2, 0.3], continuityScope: "main_relationship", arcKeys: ["arc_1"] };
  const fakeHit: InternalLogicEvidenceHit = { id: "hit_1", characterId: "zuo_ran", node: "core_belief", claimText: "Claim text", evidenceText: "Evidence text", arcKey: "arc_1", chapterKey: null, episodeLabel: null, sceneOrder: null, unitIndex: null, scopeApplicability: {}, sourceKind: "story_fact", confidenceScore: 0.9, metadata: {}, cosineSimilarity: 0.85, finalScore: 0.85 };

  it("returns results, handles throw, empty, and delegates args", async () => {
    let callCount = 0;
    const searchFn = async () => { callCount++; return [fakeHit]; };
    let results = await tryRetrieveInternalLogicEvidence(searchFn, args);
    assert.equal(results.length, 1, "returns results");
    assert.equal(callCount, 1, "called once");

    callCount = 0;
    const throwFn = async () => { callCount++; throw new Error("pgvector extension not available"); };
    const stderr: string[] = [];
    const orig = console.error;
    console.error = (...msgs: unknown[]) => { stderr.push(msgs.map(String).join(" ")); };
    try {
      results = await tryRetrieveInternalLogicEvidence(throwFn, args);
      assert.equal(results.length, 0, "degraded to [] on throw");
      assert.ok(stderr.some((s) => s.includes("pgvector extension not available")), "error logged");
      assert.ok(stderr.some((s) => s.includes("continuing without evidence")), "fallback logged");
    } finally { console.error = orig; }

    callCount = 0;
    const emptyFn = async () => { callCount++; return []; };
    results = await tryRetrieveInternalLogicEvidence(emptyFn, args);
    assert.equal(results.length, 0, "empty results passed through");

    let capturedArgs: unknown = null;
    results = await tryRetrieveInternalLogicEvidence(async (a: unknown) => { capturedArgs = a; return [fakeHit]; }, args);
    assert.equal(capturedArgs, args, "args delegated");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { olderRecallExclusiveFirstTurn, retrieveOlderRecall, shouldRetrieveStructMemConsolidations } from "./olderRecall";

function delay<T>(ms: number, value: T): Promise<T> { return new Promise((resolve) => { setTimeout(() => resolve(value), ms); }); }

describe("olderRecall", () => {
  it("runs retrievers concurrently", async () => {
    const started: string[] = [];
    const start = Date.now();
    const result = await retrieveOlderRecall({ queryEmbedding: [0.1], sessionId: "s1", characterId: "c1", memoryNamespace: "ns", exclusiveRecentWindowFirstTurn: 4, latestFrontierTurnIndex: 10, structMemEnabled: true, shouldRetrieveConsolidations: true }, { sessionMemoryChunks: async () => { started.push("chunks"); return delay(50, []); }, structMemEntries: async () => { started.push("entries"); return delay(50, []); }, structMemConsolidations: async () => { started.push("consolidations"); return delay(50, []); } });
    assert.deepEqual(result, { sessionRecall: [], structMemEntries: [], structMemConsolidations: [] });
    assert.deepEqual(started.sort(), ["chunks", "consolidations", "entries"]);
    assert.ok(Date.now() - start < 120, "concurrent (<120ms)");
  });

  it("checks StructMem consolidation retrieval flags and overlap boundary", () => {
    assert.equal(shouldRetrieveStructMemConsolidations({ structMemEnabled: false, structMemConsolidationEnabled: true, structMemCrossSessionRetrievalEnabled: true }), false, "structMem disabled → false");
    assert.equal(shouldRetrieveStructMemConsolidations({ structMemEnabled: true, structMemConsolidationEnabled: true, structMemCrossSessionRetrievalEnabled: false }), true, "cross-session disabled → true (still retrieves current)");
    assert.equal(shouldRetrieveStructMemConsolidations({ structMemEnabled: true, structMemConsolidationEnabled: false, structMemCrossSessionRetrievalEnabled: true }), true, "consolidation explicitly disabled → true (current only)");
    assert.equal(olderRecallExclusiveFirstTurn(20), 22, "overlap +2");
    assert.equal(olderRecallExclusiveFirstTurn(1), 3, "overlap for small");
    assert.equal(olderRecallExclusiveFirstTurn(1, 0), 1, "zero overlap");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  olderRecallExclusiveFirstTurn,
  retrieveOlderRecall,
  shouldRetrieveStructMemConsolidations,
} from "./olderRecall";

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });
}

describe("olderRecall", () => {
  it("runs older recall retrievers concurrently", async () => {
    const started: string[] = [];
    const start = Date.now();

    const result = await retrieveOlderRecall(
      {
        queryEmbedding: [0.1],
        sessionId: "s1",
        characterId: "c1",
        memoryNamespace: "ns",
        exclusiveRecentWindowFirstTurn: 4,
        latestFrontierTurnIndex: 10,
        structMemEnabled: true,
        retrieveStructMemConsolidations: true,
      },
      {
        sessionMemoryChunks: async () => {
          started.push("chunks");
          return delay(50, []);
        },
        structMemEntries: async () => {
          started.push("entries");
          return delay(50, []);
        },
        structMemConsolidations: async () => {
          started.push("consolidations");
          return delay(50, []);
        },
      },
    );

    assert.deepEqual(result, {
      sessionRecall: [],
      structMemEntries: [],
      structMemConsolidations: [],
    });
    assert.deepEqual(started.sort(), [
      "chunks",
      "consolidations",
      "entries",
    ]);
    assert.ok(Date.now() - start < 120);
  });

  it("checks StructMem consolidation retrieval flags", () => {
    assert.equal(
      shouldRetrieveStructMemConsolidations({
        structMemEnabled: false,
        structMemConsolidationEnabled: true,
        structMemCrossSessionRetrievalEnabled: true,
      }),
      false,
    );
    assert.equal(
      shouldRetrieveStructMemConsolidations({
        structMemEnabled: true,
        structMemConsolidationEnabled: true,
        structMemCrossSessionRetrievalEnabled: false,
      }),
      true,
    );
    assert.equal(
      shouldRetrieveStructMemConsolidations({
        structMemEnabled: true,
        structMemConsolidationEnabled: false,
        structMemCrossSessionRetrievalEnabled: true,
      }),
      true,
    );
  });

  it("adds a small overlap to the older recall boundary", () => {
    assert.equal(olderRecallExclusiveFirstTurn(20), 22);
    assert.equal(olderRecallExclusiveFirstTurn(1), 3);
    assert.equal(olderRecallExclusiveFirstTurn(1, 0), 1);
  });
});

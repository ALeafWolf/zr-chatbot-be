import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRetrievalEmbeddingBatchTracePayload,
  buildRetrievalEmbeddingRequests,
  mapRetrievalEmbeddingResults,
  runRetrievalEmbeddingBatch,
} from "./retrievalEmbeddingBatch";

describe("retrieval embedding batch", () => {
  it("includes memory, canon, raw memory, and HyDE in one ordered batch", () => {
    const requests = buildRetrievalEmbeddingRequests({
      memoryText: "memory",
      canonText: "canon",
      rawText: "raw",
      useFusedMemoryQuery: true,
      hydeEnabled: true,
      canonTier3: true,
      hypothetical: "hypothetical canon answer",
    });

    assert.deepEqual(requests.map((request) => request.key), [
      "memory",
      "canon",
      "rawMemory",
      "hyde",
    ]);
  });

  it("omits optional raw memory and HyDE embeddings when disabled or absent", () => {
    const requests = buildRetrievalEmbeddingRequests({
      memoryText: "memory",
      canonText: "canon",
      rawText: "raw",
      useFusedMemoryQuery: false,
      hydeEnabled: true,
      canonTier3: true,
      hypothetical: " ",
    });

    assert.deepEqual(requests.map((request) => request.key), [
      "memory",
      "canon",
    ]);
  });

  it("maps ordered embeddings back to retrieval fields", () => {
    const requests = buildRetrievalEmbeddingRequests({
      memoryText: "memory",
      canonText: "canon",
      rawText: "raw",
      useFusedMemoryQuery: true,
      hydeEnabled: true,
      canonTier3: true,
      hypothetical: "hypo",
    });

    const result = mapRetrievalEmbeddingResults(requests, [
      [1],
      [2],
      [3],
      [4],
    ]);

    assert.deepEqual(result.queryEmbedding, [1]);
    assert.deepEqual(result.canonQueryEmbedding, [2]);
    assert.deepEqual(result.rawMemoryQueryEmbedding, [3]);
    assert.deepEqual(result.hypotheticalQueryEmbedding, [4]);
  });

  it("builds trace payload shape for embedding requests", () => {
    const requests = buildRetrievalEmbeddingRequests({
      memoryText: "memory",
      canonText: "canon text",
      rawText: "raw",
      useFusedMemoryQuery: false,
      hydeEnabled: false,
      canonTier3: true,
    });

    const payload = buildRetrievalEmbeddingBatchTracePayload({
      requests,
      failedCount: 0,
      durationMs: 12,
    });

    assert.deepEqual(payload.queryKinds, ["memory", "canon"]);
    assert.equal(payload.inputCharCounts.memory, 6);
    assert.equal(payload.estimatedInputTokens.canon, 3);
    assert.equal(payload.requestedCount, 2);
    assert.equal(payload.failedCount, 0);
  });

  it("attaches failed-count trace payload when embedding batch fails", async () => {
    const requests = buildRetrievalEmbeddingRequests({
      memoryText: "memory",
      canonText: "canon",
      rawText: "raw",
      useFusedMemoryQuery: false,
      hydeEnabled: false,
      canonTier3: true,
    });

    await assert.rejects(
      () =>
        runRetrievalEmbeddingBatch({
          requests,
          embed: async () => {
            throw new Error("embedding failed");
          },
        }),
      (err: unknown) => {
        const trace = (err as { trace?: { failedCount?: number } }).trace;
        assert.equal(trace?.failedCount, 1);
        return true;
      },
    );
  });
});

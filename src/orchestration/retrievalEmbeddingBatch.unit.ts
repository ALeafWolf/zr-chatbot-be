import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRetrievalEmbeddingRequests,
  mapRetrievalEmbeddingResults,
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
});

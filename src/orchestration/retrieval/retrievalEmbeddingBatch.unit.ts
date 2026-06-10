import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRetrievalEmbeddingBatchTracePayload,
  buildRetrievalEmbeddingRequests,
  mapRetrievalEmbeddingResults,
  runRetrievalEmbeddingBatch,
} from "./retrievalEmbeddingBatch";

describe("retrieval embedding batch", () => {
  it("builds request list including/excluding optional paths", () => {
    // All options enabled
    let requests = buildRetrievalEmbeddingRequests({
      memoryText: "memory", canonText: "canon", rawText: "raw",
      useFusedMemoryQuery: true, hydeEnabled: true, canonTier3: true,
      hypothetical: "hypothetical canon answer",
    });
    assert.deepEqual(requests.map((r) => r.key), ["memory", "canon", "rawMemory", "hyde"], "all enabled");

    // Raw memory and HyDE omitted when disabled or absent
    requests = buildRetrievalEmbeddingRequests({
      memoryText: "memory", canonText: "canon", rawText: "raw",
      useFusedMemoryQuery: false, hydeEnabled: true, canonTier3: true,
      hypothetical: " ",
    });
    assert.deepEqual(requests.map((r) => r.key), ["memory", "canon"], "optional omitted");
  });

  it("maps ordered embeddings back to retrieval fields", () => {
    const requests = buildRetrievalEmbeddingRequests({
      memoryText: "memory", canonText: "canon", rawText: "raw",
      useFusedMemoryQuery: true, hydeEnabled: true, canonTier3: true,
      hypothetical: "hypo",
    });
    const result = mapRetrievalEmbeddingResults(requests, [[1], [2], [3], [4]]);
    assert.deepEqual(result.queryEmbedding, [1], "memory");
    assert.deepEqual(result.canonQueryEmbedding, [2], "canon");
    assert.deepEqual(result.rawMemoryQueryEmbedding, [3], "rawMemory");
    assert.deepEqual(result.hypotheticalQueryEmbedding, [4], "hyde");
  });

  it("builds trace payload shape for embedding requests", () => {
    const requests = buildRetrievalEmbeddingRequests({
      memoryText: "memory", canonText: "canon text", rawText: "raw",
      useFusedMemoryQuery: false, hydeEnabled: false, canonTier3: true,
    });
    const payload = buildRetrievalEmbeddingBatchTracePayload({
      requests, failedCount: 0, durationMs: 12,
    });
    assert.deepEqual(payload.queryKinds, ["memory", "canon"], "queryKinds");
    assert.equal(payload.inputCharCounts.memory, 6, "charCounts memory");
    assert.equal(payload.estimatedInputTokens.canon, 3, "tokens canon");
    assert.equal(payload.requestedCount, 2, "requestedCount");
    assert.equal(payload.failedCount, 0, "failedCount");
  });

  it("attaches failed-count trace payload when embedding batch fails", async () => {
    const requests = buildRetrievalEmbeddingRequests({
      memoryText: "memory", canonText: "canon", rawText: "raw",
      useFusedMemoryQuery: false, hydeEnabled: false, canonTier3: true,
    });
    await assert.rejects(
      () => runRetrievalEmbeddingBatch({ requests, embed: async () => { throw new Error("embedding failed"); } }),
      (err: unknown) => { const trace = (err as { trace?: { failedCount?: number } }).trace; assert.equal(trace?.failedCount, 1); return true; },
    );
  });
});

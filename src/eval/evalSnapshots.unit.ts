import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAgentEvalOutput, createAgentEvalCapture, createEmptyEvalSourceIds, recordLlmUsageSnapshot, recordMemoryWriteSnapshot, recordRetrievalSnapshot, recordValidationAttempt, recordValidationSnapshot, withAgentEvalCapture } from "./evalSnapshots";

describe("agent eval snapshots", () => {
  it("captures all snapshot types, handles unknown pricing, and records rerank variant/fallback", async () => {
    // Full capture
    const capture = createAgentEvalCapture({ scenarioId: "snapshot_case", evalSessionId: "eval-session" });
    await withAgentEvalCapture(capture, async () => {
      const retrieved = createEmptyEvalSourceIds(); const injected = createEmptyEvalSourceIds();
      retrieved.interactive_memory = ["mem_1"]; injected.interactive_memory = ["mem_1"];
      recordRetrievalSnapshot({ query: { rawUserMessage: "do you remember?", intent: "personal_recall", confidence: 0.82, hydeUsed: false, rawFusionUsed: true }, retrieved, injected, dropped: { duplicate: 1, lowScore: 2, correctionConflict: 3, sourceBudget: 4, other: 0 }, topSources: [{ source: "interactive_memory", id: "mem_1" }] });
      recordValidationAttempt({ attempt: 1, needsRewrite: false, inCharacter: true, canonConsistent: true, issues: [] });
      recordValidationSnapshot({ finalNeedsRewrite: false, wasRewritten: false, wasDeflected: false });
      recordLlmUsageSnapshot({ spanName: "llm.response_generation", modelProvider: "deepseek", modelName: "deepseek-chat", modelRole: "generation", inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCostUsd: 0.001, pricingKnown: true });
      recordMemoryWriteSnapshot({ status: "completed", durableMemory: { written: 1, deduplicated: 0, belowThreshold: 0 } });
    });
    const output = buildAgentEvalOutput({ capture, reply: "remembered", assistantMessageId: "assistant_1", turnIndex: 3, success: true, cleanup: { attempted: true, completed: true } });
    assert.equal(output.scenarioId, "snapshot_case", "scenarioId");
    assert.equal(output.retrieval?.dropped.sourceBudget, 4, "retrieval.drop");
    assert.equal(output.validation?.attempts.length, 1, "validation attempts");
    assert.equal(output.usage.totalTokens, 15, "usage tokens");
    assert.equal(output.usage.estimatedCostUsd, 0.001, "usage cost");
    assert.equal(output.memoryWrite.durableMemory.written, 1, "memory write");
    assert.equal(output.cleanup.completed, true, "cleanup");

    // Unknown pricing
    const capture2 = createAgentEvalCapture({ scenarioId: "unknown_cost" });
    await withAgentEvalCapture(capture2, async () => {
      recordLlmUsageSnapshot({ spanName: "llm.known", inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0.01, pricingKnown: true });
      recordLlmUsageSnapshot({ spanName: "llm.unknown", inputTokens: 2, outputTokens: 2, totalTokens: 4, estimatedCostUsd: null, pricingKnown: false });
    });
    assert.equal(capture2.usage.totalTokens, 6, "unknown pricing — total");
    assert.equal(capture2.usage.estimatedCostUsd, null, "unknown pricing — cost null");

    // Rerank variant
    const capture3 = createAgentEvalCapture({ scenarioId: "variant_test" });
    await withAgentEvalCapture(capture3, async () => {
      const r = createEmptyEvalSourceIds(); const i = createEmptyEvalSourceIds();
      recordRetrievalSnapshot({ query: { rawUserMessage: "test", intent: "general", confidence: null, hydeUsed: false, rawFusionUsed: false }, retrieved: r, injected: i, dropped: { duplicate: 0, lowScore: 0, correctionConflict: 0, sourceBudget: 0, other: 0 }, topSources: [], rerank: { enabled: true, candidateIds: createEmptyEvalSourceIds(), selected: [], rejectedCount: 0, finalContextMode: "selected_memory", needsEvidenceFallback: false, rerankVariant: "hybrid_score" } });
    });
    assert.ok(capture3.retrieval?.rerank, "rerank snapshot exists");
    assert.equal(capture3.retrieval?.rerank?.rerankVariant, "hybrid_score", "hybrid_score variant");
    assert.equal(capture3.retrieval?.rerank?.fallbackReason, undefined, "no fallback");

    // Fallback reason
    const capture4 = createAgentEvalCapture({ scenarioId: "fallback_test" });
    await withAgentEvalCapture(capture4, async () => {
      const r = createEmptyEvalSourceIds(); const i = createEmptyEvalSourceIds();
      recordRetrievalSnapshot({ query: { rawUserMessage: "test", intent: "general", confidence: null, hydeUsed: false, rawFusionUsed: false }, retrieved: r, injected: i, dropped: { duplicate: 0, lowScore: 0, correctionConflict: 0, sourceBudget: 0, other: 0 }, topSources: [], rerank: { enabled: false, candidateIds: createEmptyEvalSourceIds(), selected: [], rejectedCount: 0, finalContextMode: "recent_only", needsEvidenceFallback: false, fallbackUsed: true, rerankVariant: "deterministic_only", fallbackReason: "variant_deterministic_only" } });
    });
    assert.ok(capture4.retrieval?.rerank, "fallback — rerank snapshot exists");
    assert.equal(capture4.retrieval?.rerank?.rerankVariant, "deterministic_only", "deterministic_only variant");
    assert.equal(capture4.retrieval?.rerank?.fallbackReason, "variant_deterministic_only", "fallback reason");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAgentEvalOutput,
  createAgentEvalCapture,
  createEmptyEvalSourceIds,
  recordLlmUsageSnapshot,
  recordMemoryWriteSnapshot,
  recordRetrievalSnapshot,
  recordValidationAttempt,
  recordValidationSnapshot,
  withAgentEvalCapture,
} from "./evalSnapshots";

describe("agent eval snapshots", () => {
  it("captures retrieval, validation, usage, and memory write snapshots", async () => {
    const capture = createAgentEvalCapture({
      scenarioId: "snapshot_case",
      evalSessionId: "eval-session",
    });

    await withAgentEvalCapture(capture, async () => {
      const retrieved = createEmptyEvalSourceIds();
      const injected = createEmptyEvalSourceIds();
      retrieved.interactive_memory = ["mem_1"];
      injected.interactive_memory = ["mem_1"];
      recordRetrievalSnapshot({
        query: {
          rawUserMessage: "do you remember?",
          intent: "personal_recall",
          confidence: 0.82,
          hydeUsed: false,
          rawFusionUsed: true,
        },
        retrieved,
        injected,
        dropped: {
          duplicate: 1,
          lowScore: 2,
          correctionConflict: 3,
          sourceBudget: 4,
          other: 0,
        },
        topSources: [{ source: "interactive_memory", id: "mem_1" }],
      });
      recordValidationAttempt({
        attempt: 1,
        needsRewrite: false,
        inCharacter: true,
        canonConsistent: true,
        issues: [],
      });
      recordValidationSnapshot({
        finalNeedsRewrite: false,
        wasRewritten: false,
        wasDeflected: false,
      });
      recordLlmUsageSnapshot({
        spanName: "llm.response_generation",
        modelProvider: "deepseek",
        modelName: "deepseek-chat",
        modelRole: "generation",
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        estimatedCostUsd: 0.001,
        pricingKnown: true,
      });
      recordMemoryWriteSnapshot({
        status: "completed",
        durableMemory: { written: 1, deduplicated: 0, belowThreshold: 0 },
      });
    });

    const output = buildAgentEvalOutput({
      capture,
      reply: "remembered",
      assistantMessageId: "assistant_1",
      turnIndex: 3,
      success: true,
      cleanup: { attempted: true, completed: true },
    });

    assert.equal(output.scenarioId, "snapshot_case");
    assert.equal(output.retrieval?.dropped.sourceBudget, 4);
    assert.equal(output.validation?.attempts.length, 1);
    assert.equal(output.usage.totalTokens, 15);
    assert.equal(output.usage.estimatedCostUsd, 0.001);
    assert.equal(output.memoryWrite.durableMemory.written, 1);
    assert.equal(output.cleanup.completed, true);
  });

  it("marks total estimated cost unknown if any span has unknown pricing", async () => {
    const capture = createAgentEvalCapture({ scenarioId: "unknown_cost" });
    await withAgentEvalCapture(capture, async () => {
      recordLlmUsageSnapshot({
        spanName: "llm.known",
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        estimatedCostUsd: 0.01,
        pricingKnown: true,
      });
      recordLlmUsageSnapshot({
        spanName: "llm.unknown",
        inputTokens: 2,
        outputTokens: 2,
        totalTokens: 4,
        estimatedCostUsd: null,
        pricingKnown: false,
      });
    });

    assert.equal(capture.usage.totalTokens, 6);
    assert.equal(capture.usage.estimatedCostUsd, null);
  });
});

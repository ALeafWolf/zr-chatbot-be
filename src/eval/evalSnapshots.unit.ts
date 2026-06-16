import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAgentEvalOutput, createAgentEvalCapture, createEmptyEvalSourceIds, recordEmotionalAxisRenderSnapshot, recordEmotionalAxisUpdateSnapshot, recordLlmUsageSnapshot, recordMemoryWriteSnapshot, recordRetrievalSnapshot, recordValidationAttempt, recordValidationSnapshot, withAgentEvalCapture } from "./evalSnapshots";

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

  // ---------------------------------------------------------------------------
  // TG1 — Emotional axis eval snapshot
  // ---------------------------------------------------------------------------

  it("TG1: recordEmotionalAxisUpdateSnapshot sets update fields and preserves render", async () => {
    const capture = createAgentEvalCapture({ scenarioId: "tg1_update" });
    await withAgentEvalCapture(capture, async () => {
      recordEmotionalAxisUpdateSnapshot({
        axesBefore: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 },
        eventDeltas: { arousal: 0.06, valence: -0.04 },
        couplingsFired: ["zr_c1"],
        effectiveBaselines: {},
        axesAfter: { connection: 0, valence: -0.04, arousal: 0.06, restraint: 0.736 },
        bandsAfter: { connection: "mid", valence: "mid", arousal: "mid", restraint: "high" },
        tick: 5,
        scope: "main_relationship",
        resolvedBaselines: { connection: 0.15, valence: 0.05, arousal: 0, restraint: 0.7 },
        event: { type: "user_challenges", intensity: 1, reason: "test" },
        modelReportedConfidence: 1,
      });
    });
    assert.ok(capture.emotionalAxis, "emotionalAxis exists after update");
    assert.equal(capture.emotionalAxis!.event?.type, "user_challenges");
    assert.equal(capture.emotionalAxis!.tick, 5);
    assert.equal(capture.emotionalAxis!.scope, "main_relationship");
    assert.deepEqual(capture.emotionalAxis!.couplingsFired, ["zr_c1"]);
    assert.equal(capture.emotionalAxis!.bandsAfter!.restraint, "high");
    // Render should not be set yet
    assert.equal(capture.emotionalAxis!.render, undefined);
  });

  it("TG1: recordEmotionalAxisRenderSnapshot sets render fields and preserves update", async () => {
    const capture = createAgentEvalCapture({ scenarioId: "tg1_render" });
    await withAgentEvalCapture(capture, async () => {
      // First set update
      recordEmotionalAxisUpdateSnapshot({
        axesBefore: { connection: 0.35, valence: 0.15, arousal: 0, restraint: 0.55 },
        eventDeltas: {},
        couplingsFired: [],
        effectiveBaselines: {},
        axesAfter: { connection: 0.35, valence: 0.15, arousal: 0, restraint: 0.55 },
        bandsAfter: { connection: "mid", valence: "mid", arousal: "mid", restraint: "mid" },
        tick: 3,
        scope: "main_married",
        resolvedBaselines: { connection: 0.35, valence: 0.15, arousal: 0, restraint: 0.55 },
      });
      // Then set render
      recordEmotionalAxisRenderSnapshot({
        source: "persisted_axis_state",
        sourceTick: 3,
        bands: { connection: "mid", valence: "mid", arousal: "mid", restraint: "mid" },
        renderRuleIds: [],
        renderBlock: "[当前状态下的行为基调]\n当前状态：克制：中｜亲近：中｜情绪：中｜唤起：中",
        tier: "C",
        resolvedBaselines: { connection: 0.35, valence: 0.15, arousal: 0, restraint: 0.55 },
      });
    });
    assert.ok(capture.emotionalAxis, "emotionalAxis exists");
    assert.ok(capture.emotionalAxis!.render, "render sub-object exists");
    assert.equal(capture.emotionalAxis!.render!.source, "persisted_axis_state");
    assert.equal(capture.emotionalAxis!.render!.sourceTick, 3);
    assert.equal(capture.emotionalAxis!.render!.tier, "C");
    assert.equal(capture.emotionalAxis!.tick, 3, "update tick preserved");
    assert.equal(capture.emotionalAxis!.scope, "main_married", "update scope preserved");
    assert.ok(capture.emotionalAxis!.render!.resolvedBaselines, "render resolvedBaselines present");
    assert.equal(capture.emotionalAxis!.render!.resolvedBaselines.restraint, 0.55);
  });

  it("TG1: buildAgentEvalOutput includes emotionalAxis when present", async () => {
    const capture = createAgentEvalCapture({ scenarioId: "tg1_output" });
    await withAgentEvalCapture(capture, async () => {
      recordEmotionalAxisUpdateSnapshot({
        axesBefore: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 },
        eventDeltas: {},
        couplingsFired: [],
        effectiveBaselines: {},
        axesAfter: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 },
        bandsAfter: { connection: "mid", valence: "mid", arousal: "mid", restraint: "high" },
        tick: 1,
        scope: "main",
        resolvedBaselines: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 },
      });
    });
    const output = buildAgentEvalOutput({ capture, reply: "ok", success: true, cleanup: { attempted: true, completed: true } });
    assert.ok(output.emotionalAxis, "emotionalAxis present in output");
    assert.equal(output.emotionalAxis!.tick, 1);
  });

  it("TG1: emotionalAxis is absent in output when not recorded", async () => {
    const capture = createAgentEvalCapture({ scenarioId: "tg1_absent" });
    const output = buildAgentEvalOutput({ capture, reply: "ok", success: true, cleanup: { attempted: true, completed: true } });
    assert.equal(output.emotionalAxis, undefined, "no emotionalAxis when not recorded");
  });

  it("TG1/F2: render-only snapshot does not fabricate update-side fields", async () => {
    const capture = createAgentEvalCapture({ scenarioId: "tg1_render_only" });
    await withAgentEvalCapture(capture, async () => {
      recordEmotionalAxisRenderSnapshot({
        source: "scope_baseline_synthetic",
        sourceTick: 0,
        bands: { connection: "mid", valence: "mid", arousal: "mid", restraint: "high" },
        renderRuleIds: [],
        renderBlock: null,
        tier: "C",
        resolvedBaselines: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 },
      });
    });
    assert.ok(capture.emotionalAxis, "emotionalAxis exists");
    assert.ok(capture.emotionalAxis!.render, "render sub-object exists");
    // Update-side fields must remain undefined (not fabricated with empty casts)
    assert.equal(capture.emotionalAxis!.axesBefore, undefined, "axesBefore not fabricated");
    assert.equal(capture.emotionalAxis!.axesAfter, undefined, "axesAfter not fabricated");
    assert.equal(capture.emotionalAxis!.tick, undefined, "tick not fabricated");
    assert.equal(capture.emotionalAxis!.scope, undefined, "scope not fabricated");
    assert.equal(capture.emotionalAxis!.bandsAfter, undefined, "bandsAfter not fabricated");
    // Render-side resolvedBaselines must be present
    assert.ok(capture.emotionalAxis!.render!.resolvedBaselines, "render resolvedBaselines present");
    assert.equal(capture.emotionalAxis!.render!.resolvedBaselines.restraint, 0.7);
  });
});

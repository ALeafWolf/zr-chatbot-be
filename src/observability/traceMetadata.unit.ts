import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { models } from "../config/models";
import type { ModelBinding } from "../config/models";
import type { ChatFallbackAttempt } from "../llm/providers";
import { buildLlmTraceMetadata, buildTraceBaseMetadata, buildUsageMetadata, estimateModelCost, hashPlayerId } from "./traceMetadata";

const session = { sessionId: "s1", characterId: "zuo_ran", playerId: "raw-player-id", mode: "canonical_live", continuityScope: "main", continuityFamily: "main_world", memoryNamespace: "main:main:raw-player-id" };

describe("trace metadata", () => {
  it("builds base metadata without raw player ids and hashes deterministically", () => {
    const metadata = buildTraceBaseMetadata({ session, turnIndex: 4 });
    assert.equal(metadata.sessionId, "s1", "sessionId");
    assert.equal(metadata.characterId, "zuo_ran", "characterId");
    assert.equal(metadata.turnIndex, 4, "turnIndex");
    assert.equal("playerId" in metadata, false, "no raw playerId");
    assert.equal(metadata.playerIdHash, hashPlayerId("raw-player-id"), "playerIdHash");
    assert.notEqual(metadata.playerIdHash, "raw-player-id", "hashed");

    assert.equal(hashPlayerId("p1"), hashPlayerId("p1"), "deterministic same");
    assert.notEqual(hashPlayerId("p1"), hashPlayerId("p2"), "deterministic different");
  });

  it("builds LLM trace metadata with model info and per-provider breakdown passthrough", () => {
    // Basic model info
    let meta = buildLlmTraceMetadata({ binding: models.generation, modelRole: "generation" });
    assert.equal(meta.modelProvider, models.generation.provider, "modelProvider");
    assert.equal(meta.modelName, models.generation.model, "modelName");
    assert.equal(meta.modelRole, "generation", "modelRole");

    // Per-provider breakdown with all dimensional fields
    meta = buildLlmTraceMetadata({
      binding: { provider: "openai", model: "gpt-5-nano" }, modelRole: "generation",
      usage: { inputTokens: 1000, outputTokens: 500, cachedInputTokens: 300, cacheHitInputTokens: 200, cacheMissInputTokens: 800, cacheReadInputTokens: 150, cacheCreationInputTokens: 100, cacheCreation5mTokens: 60, cacheCreation1hTokens: 40, reasoningTokens: 25 },
    });
    assert.equal(meta.inputTokens, 1000, "inputTokens");
    assert.equal(meta.outputTokens, 500, "outputTokens");
    assert.equal(meta.cachedInputTokens, 300, "cachedInputTokens");
    assert.equal(meta.cacheHitInputTokens, 200, "cacheHitInputTokens");
    assert.equal(meta.cacheMissInputTokens, 800, "cacheMissInputTokens");
    assert.equal(meta.cacheReadInputTokens, 150, "cacheReadInputTokens");
    assert.equal(meta.cacheCreationInputTokens, 100, "cacheCreationInputTokens");
    assert.equal(meta.cacheCreation5mTokens, 60, "cacheCreation5mTokens");
    assert.equal(meta.cacheCreation1hTokens, 40, "cacheCreation1hTokens");
    assert.equal(meta.reasoningTokens, 25, "reasoningTokens");
    assert.equal(meta.pricingVersion, "2026-05-29", "pricingVersion");
    assert.equal(typeof meta.estimatedCostUsd, "number", "estimatedCostUsd");
    assert.ok(meta.usage_metadata, "usage_metadata");
    assert.equal(typeof meta.usage_metadata.input_cost, "number", "input_cost");
    assert.equal(typeof meta.usage_metadata.output_cost, "number", "output_cost");
    assert.equal(typeof meta.usage_metadata.total_cost, "number", "total_cost");
    assert.equal(Number(((meta.usage_metadata.input_cost ?? 0) + (meta.usage_metadata.output_cost ?? 0)).toFixed(8)), meta.usage_metadata.total_cost, "cost sum");

    // Omits dimensional fields when usage has only input/output
    meta = buildLlmTraceMetadata({ binding: { provider: "anthropic", model: "claude-sonnet-4-5" }, usage: { inputTokens: 100, outputTokens: 50 } });
    assert.equal(meta.inputTokens, 100, "minimal — input");
    assert.equal(meta.outputTokens, 50, "minimal — output");
    assert.equal(meta.cachedInputTokens, undefined, "minimal — cachedInputTokens undefined");
    assert.equal(meta.cacheHitInputTokens, undefined, "minimal — cacheHitInputTokens undefined");
    assert.equal(meta.cacheMissInputTokens, undefined, "minimal — cacheMissInputTokens undefined");
    assert.equal(meta.cacheReadInputTokens, undefined, "minimal — cacheReadInputTokens undefined");
    assert.equal(meta.cacheCreationInputTokens, undefined, "minimal — cacheCreationInputTokens undefined");
    assert.equal(meta.cacheCreation5mTokens, undefined, "minimal — cacheCreation5mTokens undefined");
    assert.equal(meta.cacheCreation1hTokens, undefined, "minimal — cacheCreation1hTokens undefined");
    assert.equal(meta.reasoningTokens, undefined, "minimal — reasoningTokens undefined");

    // DeepSeek cost breakdown on usage_metadata
    meta = buildLlmTraceMetadata({ binding: { provider: "deepseek", model: "deepseek-v4-pro" }, modelRole: "generation", usage: { inputTokens: 1000, outputTokens: 200, cacheHitInputTokens: 200, cacheMissInputTokens: 800, reasoningTokens: 30 } });
    assert.ok(meta.usage_metadata, "ds — usage_metadata");
    assert.ok(meta.usage_metadata.input_cost, "ds — input_cost");
    assert.equal(typeof meta.usage_metadata.input_cost_details?.cache_read, "number", "ds — cache_read");
    assert.equal(typeof meta.usage_metadata.output_cost_details?.reasoning, "number", "ds — reasoning cost");
  });

  it("buildUsageMetadata calculates known model cost", () => {
    const usage = buildUsageMetadata({ provider: "anthropic", model: "claude-sonnet-4-5" }, { inputTokens: 1000, outputTokens: 2000 });
    assert.equal(usage.inputTokens, 1000, "inputTokens");
    assert.equal(usage.outputTokens, 2000, "outputTokens");
    assert.equal(usage.totalTokens, 3000, "totalTokens");
    assert.equal(usage.usage_metadata.total_tokens, 3000, "usage_metadata total");
    assert.equal(typeof usage.estimatedCostUsd, "number", "estimatedCostUsd");
    assert.equal(usage.pricingKnown, true, "pricingKnown");
  });

  it("estimateModelCost handles all model types", () => {
    const cases = [
      { name: "unknown model → null", model: { provider: "openai", model: "unknown-model" }, tokens: { inputTokens: 1000, outputTokens: 1000 }, check: (c: ReturnType<typeof estimateModelCost>) => { assert.equal(c, null, "unknown — null"); } },
      { name: "Anthropic Sonnet with all cache dimensions", model: { provider: "anthropic", model: "claude-sonnet-4-5" }, tokens: { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 200, cacheCreation5mTokens: 100, cacheCreation1hTokens: 50 }, check: (c: NonNullable<ReturnType<typeof estimateModelCost>>) => { assert.ok(c, "sonnet — ok"); assert.equal(c.total, 0.011235, "sonnet — total"); assert.equal(Number((c.input + c.output).toFixed(8)), c.total, "sonnet — input+output"); assert.equal(c.inputDetails?.cache_read, 0.00006, "sonnet — cache_read"); assert.equal(c.inputDetails?.cache_creation, 0.000675, "sonnet — cache_creation"); assert.equal(c.outputDetails, undefined, "sonnet — outputDetails"); } },
      { name: "Anthropic streaming fallback (cacheCreationInputTokens)", model: { provider: "anthropic", model: "claude-sonnet-4-5" }, tokens: { inputTokens: 1000, outputTokens: 500, cacheCreationInputTokens: 150 }, check: (c: NonNullable<ReturnType<typeof estimateModelCost>>) => { assert.ok(c, "stream — ok"); assert.equal(c.total, 0.0110625, "stream — total"); assert.equal(Number((c.input + c.output).toFixed(8)), c.total, "stream — sum"); } },
      { name: "OpenAI gpt-5-nano with cached input", model: { provider: "openai", model: "gpt-5-nano" }, tokens: { inputTokens: 1000, outputTokens: 500, cachedInputTokens: 300 }, check: (c: NonNullable<ReturnType<typeof estimateModelCost>>) => { assert.ok(c, "nano — ok"); assert.equal(c.total, 0.0002365, "nano — total"); assert.equal(Number((c.input + c.output).toFixed(8)), c.total, "nano — sum"); assert.equal(c.inputDetails?.cache_read, 0.0000015, "nano — cache_read"); assert.equal(c.inputDetails?.cache_creation, undefined, "nano — cache_creation undefined"); } },
      { name: "OpenAI embedding model (no output)", model: { provider: "openai", model: "text-embedding-3-small" }, tokens: { inputTokens: 2000, outputTokens: 0 }, check: (c: NonNullable<ReturnType<typeof estimateModelCost>>) => { assert.ok(c, "embed — ok"); assert.equal(c.total, 0.00004, "embed — total"); } },
      { name: "DeepSeek v4-flash with hit/miss", model: { provider: "deepseek", model: "deepseek-v4-flash" }, tokens: { inputTokens: 1000, outputTokens: 500, cacheHitInputTokens: 400, cacheMissInputTokens: 600 }, check: (c: NonNullable<ReturnType<typeof estimateModelCost>>) => { assert.ok(c, "ds-flash — ok"); assert.equal(c.total, 0.00022512, "ds-flash — total"); assert.equal(Number((c.input + c.output).toFixed(8)), c.total, "ds-flash — sum"); assert.equal(c.inputDetails?.cache_read, 0.00000112, "ds-flash — cache_read"); assert.equal(c.inputDetails?.cache_creation, undefined, "ds-flash — cache_creation undefined"); } },
      { name: "DeepSeek v4-pro with hit/miss", model: { provider: "deepseek", model: "deepseek-v4-pro" }, tokens: { inputTokens: 1000, outputTokens: 200, cacheHitInputTokens: 200, cacheMissInputTokens: 800 }, check: (c: NonNullable<ReturnType<typeof estimateModelCost>>) => { assert.ok(c, "ds-pro — ok"); assert.equal(c.total, 0.00052272, "ds-pro — total"); assert.equal(Number((c.input + c.output).toFixed(8)), c.total, "ds-pro — sum"); } },
      { name: "DeepSeek legacy fallback (no cache fields)", model: { provider: "deepseek", model: "deepseek-v4-flash" }, tokens: { inputTokens: 1000, outputTokens: 500 }, check: (c: NonNullable<ReturnType<typeof estimateModelCost>>) => { assert.ok(c, "legacy — ok"); assert.equal(c.total, 0.00014 + 0.00014, "legacy — total"); assert.equal(Number((c.input + c.output).toFixed(8)), c.total, "legacy — sum"); } },
    ];
    for (const c of cases) {
      const cost = estimateModelCost(c.model as ModelBinding, c.tokens);
      c.check(cost as any);
    }
  });
});

describe("buildLlmTraceMetadata fallback handling", () => {
  const primaryBinding: ModelBinding = { provider: "openai", model: "gpt-5-mini" };
  const fallbackBinding: ModelBinding = { provider: "openai", model: "gpt-5-nano" };

  function makeAttempt(overrides?: Partial<ChatFallbackAttempt>): ChatFallbackAttempt {
    return { binding: fallbackBinding, trigger: "parse_failure", error: "parse error", inputTokens: 50, outputTokens: 10, finishReason: "stop", ...overrides };
  }

  it("handles fallback: parse-failure, drops-final, unknown-pricing, undefined-tokens, deduped, DeepSeek split, back-compat", () => {
    // Parse-failure with unknown model → null cost
    let attempt = makeAttempt({ binding: { provider: "openai", model: "unknown-model-for-test" } });
    let meta = buildLlmTraceMetadata({ binding: primaryBinding, modelRole: "validator", usage: { inputTokens: 200, outputTokens: 50 }, fallback: { used: true, attempts: [attempt] } });
    assert.equal(meta.fallbackUsed, true, "unknown — fallbackUsed");
    assert.ok(meta.fallbackAttempts, "unknown — fallbackAttempts");
    assert.equal(meta.fallbackAttempts!.length, 1, "unknown — attempts length");
    assert.equal(meta.fallbackAttempts![0]!.provider, "openai", "unknown — provider");
    assert.equal(meta.fallbackAttempts![0]!.model, "unknown-model-for-test", "unknown — model");
    assert.equal(meta.fallbackAttempts![0]!.trigger, "parse_failure", "unknown — trigger");
    assert.equal(meta.fallbackAttempts![0]!.inputTokens, 50, "unknown — input");
    assert.equal(meta.fallbackAttempts![0]!.outputTokens, 10, "unknown — output");
    assert.equal(meta.fallbackAttempts![0]!.finishReason, "stop", "unknown — finishReason");
    assert.equal(meta.fallbackAttemptTotalInputTokens, 50, "unknown — totalInput");
    assert.equal(meta.fallbackAttemptTotalOutputTokens, 10, "unknown — totalOutput");
    assert.equal(meta.fallbackAttemptEstimatedCostUsd, null, "unknown — cost null");

    // Final attempt matching primaryBinding → dropped
    const attempt1 = makeAttempt();
    const attempt2: ChatFallbackAttempt = { binding: primaryBinding, trigger: "parse_failure", error: "also failed", inputTokens: 30, outputTokens: 5, finishReason: "stop" };
    meta = buildLlmTraceMetadata({ binding: primaryBinding, modelRole: "validator", usage: { inputTokens: 30, outputTokens: 5 }, fallback: { used: true, attempts: [attempt1, attempt2] } });
    assert.equal(meta.fallbackAttempts!.length, 1, "drops final — count");
    assert.equal(meta.fallbackAttempts![0]!.model, "gpt-5-nano", "drops final — kept model");
    assert.equal(meta.fallbackAttemptTotalInputTokens, 50, "drops final — totalInput");
    assert.equal(meta.fallbackAttemptTotalOutputTokens, 10, "drops final — totalOutput");

    // Unknown pricing on attempt → null cost
    attempt = makeAttempt({ binding: { provider: "openai", model: "unknown-model" } });
    meta = buildLlmTraceMetadata({ binding: primaryBinding, usage: { inputTokens: 100, outputTokens: 20 }, fallback: { used: true, attempts: [attempt] } });
    assert.equal(meta.fallbackAttemptEstimatedCostUsd, null, "unknown pricing — null");

    // Undefined tokens → omit rollup fields
    attempt = makeAttempt({ inputTokens: undefined, outputTokens: undefined });
    meta = buildLlmTraceMetadata({ binding: primaryBinding, usage: { inputTokens: 100, outputTokens: 20 }, fallback: { used: true, attempts: [attempt] } });
    assert.equal(meta.fallbackAttemptTotalInputTokens, undefined, "undefined — totalInput");
    assert.equal(meta.fallbackAttemptTotalOutputTokens, undefined, "undefined — totalOutput");

    // All attempts deduped → empty array
    const dedupedAttempt: ChatFallbackAttempt = { binding: primaryBinding, trigger: "parse_failure", error: "failed" };
    meta = buildLlmTraceMetadata({ binding: primaryBinding, usage: { inputTokens: 100, outputTokens: 20 }, fallback: { used: true, attempts: [dedupedAttempt] } });
    assert.ok(meta.fallbackAttempts, "deduped — attempts present");
    assert.equal(meta.fallbackAttempts!.length, 0, "deduped — empty");
    assert.equal(meta.fallbackUsed, true, "deduped — fallbackUsed");

    // DeepSeek cost with hit/miss split
    attempt = makeAttempt({ binding: { provider: "deepseek", model: "deepseek-v4-pro" }, inputTokens: 200, outputTokens: 50, cacheHitInputTokens: 100, cacheMissInputTokens: 100 });
    meta = buildLlmTraceMetadata({ binding: { provider: "openai", model: "gpt-5-mini" }, usage: { inputTokens: 300, outputTokens: 80 }, fallback: { used: true, attempts: [attempt] } });
    assert.ok(meta.fallbackAttemptEstimatedCostUsd !== null, "ds split — cost not null");
    assert.ok(meta.fallbackAttemptEstimatedCostUsd! < 0.0005, "ds split — less than all-miss");
    assert.equal(meta.fallbackAttempts![0]!.cacheHitInputTokens, 100, "ds split — hit");
    assert.equal(meta.fallbackAttempts![0]!.cacheMissInputTokens, 100, "ds split — miss");

    // DeepSeek back-compat (no cache fields → all-miss)
    attempt = makeAttempt({ binding: { provider: "deepseek", model: "deepseek-v4-flash" }, inputTokens: 1000, outputTokens: 500 });
    meta = buildLlmTraceMetadata({ binding: { provider: "openai", model: "gpt-5-mini" }, usage: { inputTokens: 100, outputTokens: 20 }, fallback: { used: true, attempts: [attempt] } });
    assert.ok(meta.fallbackAttemptEstimatedCostUsd !== null, "back-compat — cost not null");
    assert.equal(Number(meta.fallbackAttemptEstimatedCostUsd!.toFixed(8)), 0.00028, "back-compat — all-miss cost");
  });
});

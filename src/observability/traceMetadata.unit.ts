import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { models } from "../config/models";
import type { ModelBinding } from "../config/models";
import type { ChatFallbackAttempt } from "../llm/providers";
import {
  buildLlmTraceMetadata,
  buildTraceBaseMetadata,
  buildUsageMetadata,
  estimateModelCost,
  hashPlayerId,
} from "./traceMetadata";

const session = {
  sessionId: "s1",
  characterId: "zuo_ran",
  playerId: "raw-player-id",
  mode: "canonical_live",
  continuityScope: "main",
  continuityFamily: "main_world",
  memoryNamespace: "main:main:raw-player-id",
};

describe("trace metadata", () => {
  it("builds base metadata without raw player ids", () => {
    const metadata = buildTraceBaseMetadata({ session, turnIndex: 4 });
    assert.equal(metadata.sessionId, "s1");
    assert.equal(metadata.characterId, "zuo_ran");
    assert.equal(metadata.turnIndex, 4);
    assert.equal("playerId" in metadata, false);
    assert.equal(metadata.playerIdHash, hashPlayerId("raw-player-id"));
    assert.notEqual(metadata.playerIdHash, "raw-player-id");
  });

  it("hashes player ids deterministically", () => {
    assert.equal(hashPlayerId("p1"), hashPlayerId("p1"));
    assert.notEqual(hashPlayerId("p1"), hashPlayerId("p2"));
  });

  it("includes model provider and model name for LLM metadata", () => {
    const metadata = buildLlmTraceMetadata({
      binding: models.generation,
      modelRole: "generation",
    });
    assert.equal(metadata.modelProvider, models.generation.provider);
    assert.equal(metadata.modelName, models.generation.model);
    assert.equal(metadata.modelRole, "generation");
  });

  it("calculates known model usage and cost", () => {
    const usage = buildUsageMetadata({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    }, {
      inputTokens: 1000,
      outputTokens: 2000,
    });
    assert.equal(usage.inputTokens, 1000);
    assert.equal(usage.outputTokens, 2000);
    assert.equal(usage.totalTokens, 3000);
    assert.equal(usage.usage_metadata.total_tokens, 3000);
    assert.equal(typeof usage.estimatedCostUsd, "number");
    assert.equal(usage.pricingKnown, true);
  });

  it("returns null cost for unknown model pricing", () => {
    const cost = estimateModelCost(
      { provider: "openai", model: "unknown-model" },
      { inputTokens: 1000, outputTokens: 1000 },
    );
    assert.equal(cost, null);
  });

  it("calculates Anthropic Sonnet cost with all four cache dimensions", () => {
    const cost = estimateModelCost(
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 200,
        cacheCreation5mTokens: 100,
        cacheCreation1hTokens: 50,
      },
    );
    // total: (1000/1M)*3 + (200/1M)*0.3 + (100/1M)*3.75 + (50/1M)*6 + (500/1M)*15
    assert.ok(cost);
    assert.equal(cost.total, 0.011235);
    assert.equal(Number((cost.input + cost.output).toFixed(8)), cost.total);
    // Breakdown details
    assert.equal(cost.inputDetails?.cache_read, 0.00006);
    assert.equal(cost.inputDetails?.cache_creation, 0.000675);
    assert.equal(cost.outputDetails, undefined);
  });

  it("falls back to 5m rate when Anthropic has only cacheCreationInputTokens (streaming path)", () => {
    const cost = estimateModelCost(
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      {
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationInputTokens: 150,
      },
    );
    // total: (1000/1M)*3 + (150/1M)*3.75 + (500/1M)*15
    assert.ok(cost);
    assert.equal(cost.total, 0.0110625);
    assert.equal(Number((cost.input + cost.output).toFixed(8)), cost.total);
  });

  it("calculates OpenAI gpt-5-nano cost with cached input", () => {
    const cost = estimateModelCost(
      { provider: "openai", model: "gpt-5-nano" },
      {
        inputTokens: 1000,
        outputTokens: 500,
        cachedInputTokens: 300,
      },
    );
    // total: (700/1M)*0.05 + (300/1M)*0.005 + (500/1M)*0.4
    assert.ok(cost);
    assert.equal(cost.total, 0.0002365);
    assert.equal(Number((cost.input + cost.output).toFixed(8)), cost.total);
    // Breakdown details: cached input mapped to cache_read
    assert.equal(cost.inputDetails?.cache_read, 0.0000015);
    assert.equal(cost.inputDetails?.cache_creation, undefined);
  });

  it("calculates OpenAI text-embedding-3-small cost (no output, no caching)", () => {
    const cost = estimateModelCost(
      { provider: "openai", model: "text-embedding-3-small" },
      { inputTokens: 2000, outputTokens: 0 },
    );
    // (2000/1M)*0.02
    assert.ok(cost);
    assert.equal(cost.total, 0.00004);
    assert.equal(Number((cost.input + cost.output).toFixed(8)), cost.total);
  });

  it("calculates DeepSeek v4-flash cost with hit/miss breakdown", () => {
    const cost = estimateModelCost(
      { provider: "deepseek", model: "deepseek-v4-flash" },
      {
        inputTokens: 1000,
        outputTokens: 500,
        cacheHitInputTokens: 400,
        cacheMissInputTokens: 600,
      },
    );
    // total: (400/1M)*0.0028 + (600/1M)*0.14 + (500/1M)*0.28
    assert.ok(cost);
    assert.equal(cost.total, 0.00022512);
    // input + output equals total when rounded to 8 decimal places
    assert.equal(Number((cost.input + cost.output).toFixed(8)), cost.total);
    // DeepSeek cache-hit maps to LangSmith's cache_read category
    assert.equal(cost.inputDetails?.cache_read, 0.00000112);
    assert.equal(cost.inputDetails?.cache_creation, undefined);
  });

  it("calculates DeepSeek v4-pro cost with hit/miss breakdown", () => {
    const cost = estimateModelCost(
      { provider: "deepseek", model: "deepseek-v4-pro" },
      {
        inputTokens: 1000,
        outputTokens: 200,
        cacheHitInputTokens: 200,
        cacheMissInputTokens: 800,
      },
    );
    // Discount rates (made permanent 2026-05-22):
    // total: (200/1M)*0.003625 + (800/1M)*0.435 + (200/1M)*0.87
    assert.ok(cost);
    assert.equal(cost.total, 0.00052272);
    assert.equal(Number((cost.input + cost.output).toFixed(8)), cost.total);
  });

  it("treats all input as cache-miss when DeepSeek cache breakdown is missing (legacy fallback)", () => {
    const cost = estimateModelCost(
      { provider: "deepseek", model: "deepseek-v4-flash" },
      { inputTokens: 1000, outputTokens: 500 },
    );
    // hit=0, miss=1000: (1000/1M)*0.14 + (500/1M)*0.28
    assert.ok(cost);
    const expected = 0.00014 + 0.00014;
    assert.equal(cost.total, expected);
    assert.equal(Number((cost.input + cost.output).toFixed(8)), cost.total);
  });
});

describe("buildLlmTraceMetadata — per-provider breakdown passthrough", () => {
  it("passes through all eight dimensional fields and usage_metadata cost fields", () => {
    const meta = buildLlmTraceMetadata({
      binding: { provider: "openai", model: "gpt-5-nano" },
      modelRole: "generation",
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        cachedInputTokens: 300,
        cacheHitInputTokens: 200,
        cacheMissInputTokens: 800,
        cacheReadInputTokens: 150,
        cacheCreationInputTokens: 100,
        cacheCreation5mTokens: 60,
        cacheCreation1hTokens: 40,
        reasoningTokens: 25,
      },
    });

    assert.equal(meta.inputTokens, 1000);
    assert.equal(meta.outputTokens, 500);
    assert.equal(meta.cachedInputTokens, 300);
    assert.equal(meta.cacheHitInputTokens, 200);
    assert.equal(meta.cacheMissInputTokens, 800);
    assert.equal(meta.cacheReadInputTokens, 150);
    assert.equal(meta.cacheCreationInputTokens, 100);
    assert.equal(meta.cacheCreation5mTokens, 60);
    assert.equal(meta.cacheCreation1hTokens, 40);
    assert.equal(meta.reasoningTokens, 25);
    assert.equal(meta.pricingVersion, "2026-05-29");
    assert.equal(typeof meta.estimatedCostUsd, "number");
    // LangSmith cost fields populated on usage_metadata
    assert.ok(meta.usage_metadata);
    assert.equal(typeof meta.usage_metadata.input_cost, "number");
    assert.equal(typeof meta.usage_metadata.output_cost, "number");
    assert.equal(typeof meta.usage_metadata.total_cost, "number");
    assert.equal(
      Number(((meta.usage_metadata.input_cost ?? 0) + (meta.usage_metadata.output_cost ?? 0)).toFixed(8)),
      meta.usage_metadata.total_cost,
    );
  });

  it("omits dimensional fields when usage has only input/output tokens", () => {
    const meta = buildLlmTraceMetadata({
      binding: { provider: "anthropic", model: "claude-sonnet-4-5" },
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    assert.equal(meta.inputTokens, 100);
    assert.equal(meta.outputTokens, 50);
    assert.equal(meta.cachedInputTokens, undefined);
    assert.equal(meta.cacheHitInputTokens, undefined);
    assert.equal(meta.cacheMissInputTokens, undefined);
    assert.equal(meta.cacheReadInputTokens, undefined);
    assert.equal(meta.cacheCreationInputTokens, undefined);
    assert.equal(meta.cacheCreation5mTokens, undefined);
    assert.equal(meta.cacheCreation1hTokens, undefined);
    assert.equal(meta.reasoningTokens, undefined);
  });

  it("populates usage_metadata with cost breakdown for DeepSeek v4-pro", () => {
    const meta = buildLlmTraceMetadata({
      binding: { provider: "deepseek", model: "deepseek-v4-pro" },
      modelRole: "generation",
      usage: {
        inputTokens: 1000,
        outputTokens: 200,
        cacheHitInputTokens: 200,
        cacheMissInputTokens: 800,
        reasoningTokens: 30,
      },
    });

    assert.ok(meta.usage_metadata);
    // input_cost should include cache-hit sub-cost
    assert.ok(meta.usage_metadata.input_cost);
    assert.equal(typeof meta.usage_metadata.input_cost_details?.cache_read, "number");
    // reasoning tokens → output_cost_details.reasoning
    assert.equal(typeof meta.usage_metadata.output_cost_details?.reasoning, "number");
  });
});

describe("buildLlmTraceMetadata fallback handling", () => {
  const primaryBinding: ModelBinding = { provider: "openai", model: "gpt-5-mini" };
  const fallbackBinding: ModelBinding = { provider: "openai", model: "gpt-5-nano" };

  function makeAttempt(overrides?: Partial<ChatFallbackAttempt>): ChatFallbackAttempt {
    return {
      binding: fallbackBinding,
      trigger: "parse_failure",
      error: "parse error",
      inputTokens: 50,
      outputTokens: 10,
      finishReason: "stop",
      ...overrides,
    };
  }

  it("populates fallbackUsed, fallbackAttempts, and rollup sums with one parse-failure attempt", () => {
    // Use a deliberately unknown model so pricing is null → tests the
    // "unknown pricing" branch without coupling to the live pricing table.
    const attempt = makeAttempt({ binding: { provider: "openai", model: "unknown-model-for-test" } });
    const meta = buildLlmTraceMetadata({
      binding: primaryBinding,
      modelRole: "validator",
      usage: { inputTokens: 200, outputTokens: 50 },
      fallback: { used: true, attempts: [attempt] },
    });

    assert.equal(meta.fallbackUsed, true);
    assert.ok(meta.fallbackAttempts);
    assert.equal(meta.fallbackAttempts!.length, 1);
    assert.equal(meta.fallbackAttempts![0]!.provider, "openai");
    assert.equal(meta.fallbackAttempts![0]!.model, "unknown-model-for-test");
    assert.equal(meta.fallbackAttempts![0]!.trigger, "parse_failure");
    assert.equal(meta.fallbackAttempts![0]!.inputTokens, 50);
    assert.equal(meta.fallbackAttempts![0]!.outputTokens, 10);
    assert.equal(meta.fallbackAttempts![0]!.finishReason, "stop");
    assert.equal(meta.fallbackAttemptTotalInputTokens, 50);
    assert.equal(meta.fallbackAttemptTotalOutputTokens, 10);
    // Unknown pricing → null
    assert.equal(meta.fallbackAttemptEstimatedCostUsd, null);
  });

  it("drops final attempt when its binding matches the trace binding", () => {
    const attempt1 = makeAttempt(); // fallbackBinding
    const attempt2: ChatFallbackAttempt = {
      binding: primaryBinding,
      trigger: "parse_failure",
      error: "also failed",
      inputTokens: 30,
      outputTokens: 5,
      finishReason: "stop",
    };
    const meta = buildLlmTraceMetadata({
      binding: primaryBinding,
      modelRole: "validator",
      usage: { inputTokens: 30, outputTokens: 5 },
      fallback: { used: true, attempts: [attempt1, attempt2] },
    });

    // Final attempt (attempt2) matches primaryBinding → dropped
    assert.equal(meta.fallbackAttempts!.length, 1);
    assert.equal(meta.fallbackAttempts![0]!.model, "gpt-5-nano");
    // Rollup should only include the non-final attempt
    assert.equal(meta.fallbackAttemptTotalInputTokens, 50);
    assert.equal(meta.fallbackAttemptTotalOutputTokens, 10);
  });

  it("sets fallbackAttemptEstimatedCostUsd to null when any attempt has unknown pricing", () => {
    const attempt = makeAttempt({ binding: { provider: "openai", model: "unknown-model" } });
    const meta = buildLlmTraceMetadata({
      binding: primaryBinding,
      usage: { inputTokens: 100, outputTokens: 20 },
      fallback: { used: true, attempts: [attempt] },
    });

    assert.equal(meta.fallbackAttemptEstimatedCostUsd, null);
  });

  it("omits rollup fields when all per-attempt token values are undefined", () => {
    const attempt = makeAttempt({ inputTokens: undefined, outputTokens: undefined });
    const meta = buildLlmTraceMetadata({
      binding: primaryBinding,
      usage: { inputTokens: 100, outputTokens: 20 },
      fallback: { used: true, attempts: [attempt] },
    });

    assert.equal(meta.fallbackAttemptTotalInputTokens, undefined);
    assert.equal(meta.fallbackAttemptTotalOutputTokens, undefined);
  });

  it("sets fallbackAttempts to empty array when all attempts deduped away", () => {
    const attempt: ChatFallbackAttempt = {
      binding: primaryBinding,
      trigger: "parse_failure",
      error: "failed",
    };
    const meta = buildLlmTraceMetadata({
      binding: primaryBinding,
      usage: { inputTokens: 100, outputTokens: 20 },
      fallback: { used: true, attempts: [attempt] },
    });

    // attempt binding matches primaryBinding → dropped
    assert.ok(meta.fallbackAttempts);
    assert.equal(meta.fallbackAttempts!.length, 0);
    assert.equal(meta.fallbackUsed, true);
  });
});

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

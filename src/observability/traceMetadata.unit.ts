import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { models } from "../config/models";
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

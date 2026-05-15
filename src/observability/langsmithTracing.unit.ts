import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { models } from "../config/models";
import { buildTraceBaseMetadata } from "./traceMetadata";
import { __testing, withTraceContext } from "./langsmithTracing";

describe("langsmith tracing wrappers", () => {
  it("omits turn:foreground from root trace tags", async () => {
    const baseMetadata = buildTraceBaseMetadata({
      session: {
        sessionId: "s1",
        characterId: "zuo_ran",
        playerId: "p1",
        mode: "canonical_live",
        continuityScope: "main",
        continuityFamily: "main_world",
        memoryNamespace: "main:main:p1",
      },
    });
    await withTraceContext(
      {
        baseMetadata,
        characterId: "zuo_ran",
        turn: "foreground",
      },
      async () => {
        const tags = __testing.buildTags("orchestration.run_character_turn_stream", {
          root: true,
          subsystem: "orchestration",
        });
        assert.deepEqual(tags, [
          `env:${baseMetadata.environment}`,
          "character:zuo_ran",
          "subsystem:orchestration",
        ]);
      },
    );
  });

  it("adds usage metadata to processed LLM outputs", () => {
    const processed = __testing.withLlmOutputMetadata(
      { status: "ok" },
      {
        modelProvider: models.generation.provider,
        modelName: models.generation.model,
        modelRole: "generation",
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        estimatedCostUsd: 0.00033,
        pricingKnown: true,
        pricingVersion: "test",
        usage_metadata: {
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
        },
      },
    );
    assert.equal(processed.inputTokens, 10);
    assert.deepEqual(processed.usage_metadata, {
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
    });
  });
});

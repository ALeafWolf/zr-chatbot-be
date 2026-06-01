import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { models } from "../config/models";
import {
  attachTraceLlmMetadata,
  buildTraceBaseMetadata,
} from "./traceMetadata";
import { runRetrievalEmbeddingBatch } from "../orchestration/retrieval/retrievalEmbeddingBatch";
import {
  __testing,
  withTraceContext,
  withLangSmithTracingSuppressed,
  isLangSmithTracingSuppressed,
} from "./langsmithTracing";

describe("langsmith tracing wrappers", () => {
  it("disables LangSmith emission during unit tests", () => {
    assert.equal(__testing.isTestProcess(), true);
    assert.equal(__testing.shouldTraceLangSmith(), false);
    for (const key of [
      "LANGSMITH_TRACING",
      "LANGSMITH_TRACING_V2",
      "LANGCHAIN_TRACING",
      "LANGCHAIN_TRACING_V2",
      "TRACING",
      "TRACING_V2",
    ]) {
      assert.equal(process.env[key], "false", `${key} should be forced off`);
    }
    assert.equal(process.env.LANGSMITH_API_KEY, "");
    assert.equal(process.env.LANGCHAIN_API_KEY, "");
  });

  it("runs trace-wrapped functions without LangSmith emission", async () => {
    assert.equal(__testing.shouldTraceLangSmith(), false);

    const result = await runRetrievalEmbeddingBatch({
      requests: [
        { key: "memory", text: "memory" },
        { key: "canon", text: "canon" },
      ],
      embed: async (text) => [text.length],
    });

    assert.deepEqual(result.queryEmbedding, [6]);
    assert.deepEqual(result.canonQueryEmbedding, [5]);
    assert.equal(result.trace.requestedCount, 2);
    assert.equal(result.trace.failedCount, 0);
  });

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
        ls_provider: models.generation.provider,
        ls_model_name: models.generation.model,
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

  it("extracts attached LLM metadata from direct outputs", () => {
    const output = attachTraceLlmMetadata(
      { ok: true },
      {
        binding: models.extractor,
        modelRole: "extractor",
        usage: { inputTokens: 11, outputTokens: 7 },
      },
    );

    const metadata = __testing.extractLlmMetadata(output, {
      llm: { binding: models.extractor, modelRole: "extractor" },
    });

    assert.equal(metadata?.inputTokens, 11);
    assert.equal(metadata?.outputTokens, 7);
    assert.equal(metadata?.usage_metadata?.total_tokens, 18);
    assert.equal(metadata?.ls_model_name, models.extractor.model);
  });

  it("keeps attached LLM metadata after LangSmith shallow-clones outputs", () => {
    const output = attachTraceLlmMetadata(
      { ok: true },
      {
        binding: models.extractor,
        modelRole: "extractor",
        usage: { inputTokens: 13, outputTokens: 8 },
      },
    );
    const clonedOutput = { ...output };

    const metadata = __testing.extractLlmMetadata(clonedOutput, {
      llm: { binding: models.extractor, modelRole: "extractor" },
    });

    assert.equal(metadata?.inputTokens, 13);
    assert.equal(metadata?.outputTokens, 8);
    assert.equal(metadata?.usage_metadata?.total_tokens, 21);
  });

  it("extracts attached LLM metadata from wrapped output shapes", () => {
    const output = attachTraceLlmMetadata(
      { ok: true },
      {
        binding: models.validator,
        modelRole: "validator",
        usage: { inputTokens: 20, outputTokens: 5 },
      },
    );

    const metadata = __testing.extractLlmMetadata(
      { output },
      { llm: { binding: models.validator, modelRole: "validator" } },
    );

    assert.equal(metadata?.inputTokens, 20);
    assert.equal(metadata?.outputTokens, 5);
    assert.equal(metadata?.usage_metadata?.total_tokens, 25);
  });

  it("extracts usage from plain wrapped token output shapes", () => {
    const metadata = __testing.extractLlmMetadata(
      { output: { inputTokens: 6, outputTokens: 4 } },
      { llm: { binding: models.generation, modelRole: "generation" } },
    );

    assert.equal(metadata?.inputTokens, 6);
    assert.equal(metadata?.outputTokens, 4);
    assert.equal(metadata?.usage_metadata?.total_tokens, 10);
  });
});

// ---------------------------------------------------------------------------
// withLangSmithTracingSuppressed
// ---------------------------------------------------------------------------

describe("withLangSmithTracingSuppressed", () => {
  it("isLangSmithTracingSuppressed returns false outside suppressed scope", () => {
    assert.equal(isLangSmithTracingSuppressed(), false);
  });

  it("suppresses tracing inside the scope", async () => {
    let inside = false;
    await withLangSmithTracingSuppressed(async () => {
      inside = isLangSmithTracingSuppressed();
    });
    assert.equal(inside, true);
  });

  it("isLangSmithTracingSuppressed returns true inside scope", async () => {
    await withLangSmithTracingSuppressed(async () => {
      assert.equal(isLangSmithTracingSuppressed(), true);
    });
  });

  it("restores the previous state after the scope ends", async () => {
    assert.equal(isLangSmithTracingSuppressed(), false);
    await withLangSmithTracingSuppressed(async () => {
      assert.equal(isLangSmithTracingSuppressed(), true);
    });
    assert.equal(isLangSmithTracingSuppressed(), false);
  });

  it("suppression is scoped to the async function execution", async () => {
    // Suppression is active only while the wrapped function runs;
    // awaited promises within the scope inherit the ALS context.
    let inside = false;
    const result = await withLangSmithTracingSuppressed(async () => {
      inside = isLangSmithTracingSuppressed();
      return "done";
    });
    assert.equal(inside, true);
    assert.equal(result, "done");
    assert.equal(isLangSmithTracingSuppressed(), false);
  });

  it("calls the wrapped function and returns its value", async () => {
    const result = await withLangSmithTracingSuppressed(async () => 42);
    assert.equal(result, 42);
  });

  it("forwards rejections from the wrapped function", async () => {
    await assert.rejects(
      withLangSmithTracingSuppressed(async () => {
        throw new Error("test error");
      }),
      /test error/,
    );
  });
});

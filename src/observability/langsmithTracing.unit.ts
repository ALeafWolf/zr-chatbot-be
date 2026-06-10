import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { models } from "../config/models";
import { attachTraceLlmMetadata, buildTraceBaseMetadata } from "./traceMetadata";
import { runRetrievalEmbeddingBatch } from "../orchestration/retrieval/retrievalEmbeddingBatch";
import { __testing, withTraceContext, withLangSmithTracingSuppressed, isLangSmithTracingSuppressed } from "./langsmithTracing";

describe("langsmith tracing wrappers", () => {
  it("disables LangSmith during unit tests with env vars forced off", () => {
    assert.equal(__testing.isTestProcess(), true, "isTestProcess");
    assert.equal(__testing.shouldTraceLangSmith(), false, "shouldTrace");
    for (const key of ["LANGSMITH_TRACING", "LANGSMITH_TRACING_V2", "LANGCHAIN_TRACING", "LANGCHAIN_TRACING_V2", "TRACING", "TRACING_V2"]) {
      assert.equal(process.env[key], "false", `${key} should be forced off`);
    }
    assert.equal(process.env.LANGSMITH_API_KEY, "", "API key empty");
    assert.equal(process.env.LANGCHAIN_API_KEY, "", "LangChain key empty");
  });

  it("runs trace-wrapped functions without emission and omits turn:foreground tags", async () => {
    assert.equal(__testing.shouldTraceLangSmith(), false, "no tracing");

    const result = await runRetrievalEmbeddingBatch({
      requests: [{ key: "memory", text: "memory" }, { key: "canon", text: "canon" }],
      embed: async (text) => [text.length],
    });
    assert.deepEqual(result.queryEmbedding, [6], "embedding memory");
    assert.deepEqual(result.canonQueryEmbedding, [5], "embedding canon");
    assert.equal(result.trace.requestedCount, 2, "requestedCount");
    assert.equal(result.trace.failedCount, 0, "failedCount");

    // Omit turn:foreground from root tags
    const baseMetadata = buildTraceBaseMetadata({ session: { sessionId: "s1", characterId: "zuo_ran", playerId: "p1", mode: "canonical_live", continuityScope: "main", continuityFamily: "main_world", memoryNamespace: "main:main:p1" } });
    await withTraceContext({ baseMetadata, characterId: "zuo_ran", turn: "foreground" }, async () => {
      const tags = __testing.buildTags("orchestration.run_character_turn_stream", { root: true, subsystem: "orchestration" });
      assert.deepEqual(tags, [`env:${baseMetadata.environment}`, "character:zuo_ran", "subsystem:orchestration"], "no turn:foreground tag");
    });
  });

  it("extracts LLM metadata from direct, cloned, wrapped, and plain token output shapes", () => {
    // Direct output with usage metadata
    const processed = __testing.withLlmOutputMetadata(
      { status: "ok" },
      { modelProvider: models.generation.provider, modelName: models.generation.model, ls_provider: models.generation.provider, ls_model_name: models.generation.model, modelRole: "generation", inputTokens: 10, outputTokens: 20, totalTokens: 30, estimatedCostUsd: 0.00033, pricingKnown: true, pricingVersion: "test", usage_metadata: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } },
    );
    assert.equal(processed.inputTokens, 10, "processed — inputTokens");
    assert.deepEqual(processed.usage_metadata, { input_tokens: 10, output_tokens: 20, total_tokens: 30 }, "processed — usage_metadata");

    // Extracted from direct output
    let output = attachTraceLlmMetadata({ ok: true }, { binding: models.extractor, modelRole: "extractor", usage: { inputTokens: 11, outputTokens: 7 } });
    let metadata = __testing.extractLlmMetadata(output, { llm: { binding: models.extractor, modelRole: "extractor" } });
    assert.equal(metadata?.inputTokens, 11, "direct — input");
    assert.equal(metadata?.outputTokens, 7, "direct — output");
    assert.equal(metadata?.usage_metadata?.total_tokens, 18, "direct — total");
    assert.equal(metadata?.ls_model_name, models.extractor.model, "direct — model");

    // Kept after LangSmith shallow clone
    const cloneOutput = attachTraceLlmMetadata({ ok: true }, { binding: models.extractor, modelRole: "extractor", usage: { inputTokens: 13, outputTokens: 8 } });
    let clonedOutput = { ...cloneOutput };
    metadata = __testing.extractLlmMetadata(clonedOutput, { llm: { binding: models.extractor, modelRole: "extractor" } });
    assert.equal(metadata?.inputTokens, 13, "clone — input");
    assert.equal(metadata?.outputTokens, 8, "clone — output");
    assert.equal(metadata?.usage_metadata?.total_tokens, 21, "clone — total");

    // Extracted from wrapped output shape
    let output2 = attachTraceLlmMetadata({ ok: true }, { binding: models.validator, modelRole: "validator", usage: { inputTokens: 20, outputTokens: 5 } });
    metadata = __testing.extractLlmMetadata({ output: output2 }, { llm: { binding: models.validator, modelRole: "validator" } });
    assert.equal(metadata?.inputTokens, 20, "wrapped — input");
    assert.equal(metadata?.outputTokens, 5, "wrapped — output");
    assert.equal(metadata?.usage_metadata?.total_tokens, 25, "wrapped — total");

    // Plain wrapped token output shapes
    metadata = __testing.extractLlmMetadata({ output: { inputTokens: 6, outputTokens: 4 } }, { llm: { binding: models.generation, modelRole: "generation" } });
    assert.equal(metadata?.inputTokens, 6, "plain — input");
    assert.equal(metadata?.outputTokens, 4, "plain — output");
    assert.equal(metadata?.usage_metadata?.total_tokens, 10, "plain — total");
  });
});

describe("withLangSmithTracingSuppressed", () => {
  it("manages suppression scope correctly (outside false, inside true, restore, scoped, return, reject)", async () => {
    // Outside scope: false
    assert.equal(isLangSmithTracingSuppressed(), false, "outside — false");

    // Inside scope: true
    let inside = false;
    await withLangSmithTracingSuppressed(async () => { inside = isLangSmithTracingSuppressed(); });
    assert.equal(inside, true, "suppressed inside scope");

    // isLangSmithTracingSuppressed returns true inside scope
    await withLangSmithTracingSuppressed(async () => {
      assert.equal(isLangSmithTracingSuppressed(), true, "inside — isSuppressed true");
    });

    // Restores after scope ends
    assert.equal(isLangSmithTracingSuppressed(), false, "restored — false");
    await withLangSmithTracingSuppressed(async () => { assert.equal(isLangSmithTracingSuppressed(), true, "inside scope"); });
    assert.equal(isLangSmithTracingSuppressed(), false, "after scope — false");

    // Suppression is scoped to async execution
    inside = false;
    const result = await withLangSmithTracingSuppressed(async () => { inside = isLangSmithTracingSuppressed(); return "done"; });
    assert.equal(inside, true, "scoped — inside");
    assert.equal(result, "done", "scoped — return value");
    assert.equal(isLangSmithTracingSuppressed(), false, "scoped — restored");

    // Returns the wrapped function's value
    const val = await withLangSmithTracingSuppressed(async () => 42);
    assert.equal(val, 42, "return — 42");

    // Forwards rejections
    await assert.rejects(
      withLangSmithTracingSuppressed(async () => { throw new Error("test error"); }),
      /test error/,
      "rejection — forwarded",
    );
  });
});

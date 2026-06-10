import { describe, it, before, mock } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

// ---------------------------------------------------------------------------
// env.ts GENERATION_MAX_TOKENS transform tests — no module mocking needed
// ---------------------------------------------------------------------------

function generationMaxTokensTransform(v: string | undefined): number {
  const s = z.string().default("8192");
  const raw = s.parse(v);
  const n = parseInt(raw.trim(), 10);
  if (Number.isNaN(n) || n < 1) return 8192;
  if (n <= 4096) return 8192;
  return Math.min(16384, n);
}

describe("GENERATION_MAX_TOKENS default and clamp", () => {
  it("defaults to 8192, is above 4096, clamps low, passes mid, caps high, handles invalid", async () => {
    // Default
    const { env } = await import("../../config/env");
    assert.equal(env.GENERATION_MAX_TOKENS, 8192, "default 8192");
    assert.ok(env.GENERATION_MAX_TOKENS > 4096, "above 4096");

    // Clamps at or below 4096 → 8192
    assert.equal(generationMaxTokensTransform("1"), 8192, "1 → 8192");
    assert.equal(generationMaxTokensTransform("500"), 8192, "500 → 8192");
    assert.equal(generationMaxTokensTransform("4096"), 8192, "4096 → 8192");

    // Passes through values above 4096 within range
    assert.equal(generationMaxTokensTransform("8192"), 8192, "8192 → 8192");
    assert.equal(generationMaxTokensTransform("10000"), 10000, "10000 → 10000");
    assert.equal(generationMaxTokensTransform("16384"), 16384, "16384 → 16384");

    // Caps above 16384
    assert.equal(generationMaxTokensTransform("20000"), 16384, "20000 → 16384");
    assert.equal(generationMaxTokensTransform("99999"), 16384, "99999 → 16384");

    // Invalid/missing/empty
    assert.equal(generationMaxTokensTransform(undefined), 8192, "undefined → 8192");
    assert.equal(generationMaxTokensTransform(""), 8192, "empty → 8192");
    assert.equal(generationMaxTokensTransform("not_a_number"), 8192, "NaN → 8192");
    assert.equal(generationMaxTokensTransform("0"), 8192, "0 → 8192");
    assert.equal(generationMaxTokensTransform("-1"), 8192, "-1 → 8192");
  });
});

// ---------------------------------------------------------------------------
// generateWithToolsStream diagnostics tests
// ---------------------------------------------------------------------------

/** Mutable delegate — each scenario sets this before consuming the stream. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _mockEvents: () => AsyncGenerator<any>;

mock.module("../../llm/providers", {
  namedExports: {
    getProvider: () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      streamChat: async function* (..._args: any[]) { yield* _mockEvents(); },
      chat: () => ({ content: "", inputTokens: 0, outputTokens: 0 }),
    }),
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let generateWithToolsStream: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let env: any;

describe("generateWithToolsStream diagnostics", () => {
  before(async () => {
    generateWithToolsStream = (await import("./generateWithTools")).generateWithToolsStream;
    env = (await import("../../config/env")).env;
  });

  it("reports hasContent, reasoning, tool tracking, and reasoningTokens on done event", async () => {
    // hasContent:true, non-empty
    _mockEvents = async function* () {
      yield { type: "assistant_done" as const, content: "Hello world", toolCalls: undefined, usage: { inputTokens: 10, outputTokens: 5 }, finishReason: "stop" };
    };
    let results: unknown[] = [];
    let gen = generateWithToolsStream({ messages: [{ role: "user", content: "hi" }], ctx: {}, enableTools: false });
    for await (const ev of gen) results.push(ev);
    let done = results.find((r) => (r as { type: string }).type === "done") as Record<string, unknown>;
    assert.ok(done, "hasContent — done exists");
    assert.equal(done.hasContent, true, "hasContent — true");
    assert.equal(done.contentChars, 11, "hasContent — contentChars");
    assert.equal(done.finishReason, "stop", "hasContent — finishReason");
    assert.equal(done.maxTokens, env.GENERATION_MAX_TOKENS, "hasContent — maxTokens");
    assert.equal(done.generationRounds, 1, "hasContent — rounds");
    assert.equal(done.toolCallCount, 0, "hasContent — toolCallCount");
    assert.deepEqual(done.toolCallNames, [], "hasContent — toolCallNames");

    // hasContent:false, empty content
    _mockEvents = async function* () {
      yield { type: "assistant_done" as const, content: "", toolCalls: undefined, usage: { inputTokens: 10, outputTokens: 5 }, finishReason: "stop" };
    };
    results = [];
    gen = generateWithToolsStream({ messages: [{ role: "user", content: "hi" }], ctx: {}, enableTools: false });
    for await (const ev of gen) results.push(ev);
    done = results.find((r) => (r as { type: string }).type === "done") as Record<string, unknown>;
    assert.ok(done, "empty — done exists");
    assert.equal(done.hasContent, false, "empty — hasContent false");
    assert.equal(done.contentChars, 0, "empty — contentChars");
    assert.equal(done.finishReason, "stop", "empty — finishReason");

    // reasoning streamed
    _mockEvents = async function* () {
      yield { type: "delta" as const, reasoning: "Let me think about this..." };
      yield { type: "delta" as const, text: "Here is the answer." };
      yield { type: "assistant_done" as const, content: "Here is the answer.", toolCalls: undefined, usage: { inputTokens: 15, outputTokens: 8 }, finishReason: "stop" };
    };
    results = [];
    gen = generateWithToolsStream({ messages: [{ role: "user", content: "hi" }], ctx: {}, enableTools: false });
    for await (const ev of gen) results.push(ev);
    done = results.find((r) => (r as { type: string }).type === "done") as Record<string, unknown>;
    assert.ok(done, "reasoning — done exists");
    assert.ok((done.reasoningChars as number) > 0, "reasoning — reasoningChars > 0");
    assert.equal(done.hasReasoning, true, "reasoning — hasReasoning");

    // reasoningTokens propagated from provider
    _mockEvents = async function* () {
      yield { type: "assistant_done" as const, content: "Final answer.", toolCalls: undefined, usage: { inputTokens: 50, outputTokens: 20, reasoningTokens: 42 }, finishReason: "stop" };
    };
    results = [];
    gen = generateWithToolsStream({ messages: [{ role: "user", content: "hi" }], ctx: {}, enableTools: false });
    for await (const ev of gen) results.push(ev);
    done = results.find((r) => (r as { type: string }).type === "done") as Record<string, unknown>;
    assert.ok(done, "reasoningTokens — done exists");
    assert.equal(done.reasoningTokens, 42, "reasoningTokens — 42");

    // Tool calls across rounds
    let round = 0;
    _mockEvents = async function* () {
      round++;
      if (round === 1) {
        yield { type: "assistant_done" as const, content: "", toolCalls: [{ id: "c1", name: "web_search", arguments: '{"q":"weather"}' }], usage: { inputTokens: 20, outputTokens: 15 }, finishReason: "tool_calls" };
      } else {
        yield { type: "assistant_done" as const, content: "", toolCalls: undefined, usage: { inputTokens: 30, outputTokens: 5 }, finishReason: "stop" };
      }
    };
    results = [];
    gen = generateWithToolsStream({ messages: [{ role: "user", content: "test" }], ctx: { signal: new AbortController().signal }, enableTools: true, allowedToolNames: ["nonexistent_tool"] });
    for await (const ev of gen) results.push(ev);
    assert.equal(results.filter((r) => (r as { type: string }).type === "before_tool").length, 1, "tool — before_tool count");
    assert.equal(results.filter((r) => (r as { type: string }).type === "after_tool").length, 1, "tool — after_tool count");
    done = results.find((r) => (r as { type: string }).type === "done") as Record<string, unknown>;
    assert.ok(done, "tool — done exists");
    assert.equal(done.content, "", "tool — content");
    assert.equal(done.finishReason, "stop", "tool — finishReason");
    assert.equal(done.contentChars, 0, "tool — contentChars");
    assert.equal(done.hasContent, false, "tool — hasContent");
    assert.equal(done.toolCallCount, 1, "tool — toolCallCount");
    assert.deepEqual(done.toolCallNames, ["web_search"], "tool — toolCallNames");
    assert.equal(done.maxTokens, env.GENERATION_MAX_TOKENS, "tool — maxTokens");
    assert.equal(done.generationRounds, 2, "tool — generationRounds");
  });
});

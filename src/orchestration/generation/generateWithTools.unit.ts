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
  it("defaults to 8192", async () => {
    const { env } = await import("../../config/env");
    assert.equal(env.GENERATION_MAX_TOKENS, 8192);
  });

  it("is above the previous hard-coded 4096", async () => {
    const { env } = await import("../../config/env");
    assert.ok(env.GENERATION_MAX_TOKENS > 4096);
  });

  it("clamps values at or below 4096 back to 8192", () => {
    assert.equal(generationMaxTokensTransform("1"), 8192);
    assert.equal(generationMaxTokensTransform("500"), 8192);
    assert.equal(generationMaxTokensTransform("4096"), 8192);
  });

  it("passes values above 4096 through unchanged when within range", () => {
    assert.equal(generationMaxTokensTransform("8192"), 8192);
    assert.equal(generationMaxTokensTransform("10000"), 10000);
    assert.equal(generationMaxTokensTransform("16384"), 16384);
  });

  it("caps values above 16384 at 16384", () => {
    assert.equal(generationMaxTokensTransform("20000"), 16384);
    assert.equal(generationMaxTokensTransform("99999"), 16384);
  });

  it("returns 8192 for missing, empty, or invalid input", () => {
    assert.equal(generationMaxTokensTransform(undefined), 8192);
    assert.equal(generationMaxTokensTransform(""), 8192);
    assert.equal(generationMaxTokensTransform("not_a_number"), 8192);
    assert.equal(generationMaxTokensTransform("0"), 8192);
    assert.equal(generationMaxTokensTransform("-1"), 8192);
  });
});

// ---------------------------------------------------------------------------
// generateWithToolsStream diagnostics tests
//
// mock.module can only be called ONCE per specifier per process, so we
// set it at the top level. Each test redefines a mutable delegate to
// control what the mock provider returns per scenario.
// ---------------------------------------------------------------------------

/** Mutable delegate — each test sets this before consuming the stream. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _mockEvents: () => AsyncGenerator<any>;

// Set up the single module mock at the top level.
mock.module("../../llm/providers", {
  namedExports: {
    getProvider: () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      streamChat: async function* (..._args: any[]) {
        yield* _mockEvents();
      },
      chat: () => ({ content: "", inputTokens: 0, outputTokens: 0 }),
    }),
  },
});

// Module-level vars filled by the before() call.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let generateWithToolsStream: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let env: any;

describe("generateWithToolsStream diagnostics", () => {
  before(async () => {
    generateWithToolsStream = (await import("./generateWithTools")).generateWithToolsStream;
    env = (await import("../../config/env")).env;
  });

  it("reports hasContent:true and contentChars for non-empty content (single round, no tools)", async () => {
    _mockEvents = async function* () {
      yield {
        type: "assistant_done" as const,
        content: "Hello world",
        toolCalls: undefined,
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
      };
    };

    const results: unknown[] = [];
    const gen = generateWithToolsStream({
      messages: [{ role: "user", content: "hi" }],
      ctx: {},
      enableTools: false,
    });
    for await (const ev of gen) results.push(ev);

    const done = results.find(
      (r) => (r as { type: string }).type === "done",
    ) as Record<string, unknown>;
    assert.ok(done);
    assert.equal(done.hasContent, true);
    assert.equal(done.contentChars, 11);
    assert.equal(done.finishReason, "stop");
    assert.equal(done.maxTokens, env.GENERATION_MAX_TOKENS);
    assert.equal(done.generationRounds, 1);
    assert.equal(done.toolCallCount, 0);
    assert.deepEqual(done.toolCallNames, []);
  });

  it("reports hasContent:false for empty content with finishReason:stop (single round, no tools)", async () => {
    _mockEvents = async function* () {
      yield {
        type: "assistant_done" as const,
        content: "",
        toolCalls: undefined,
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
      };
    };

    const results: unknown[] = [];
    const gen = generateWithToolsStream({
      messages: [{ role: "user", content: "hi" }],
      ctx: {},
      enableTools: false,
    });
    for await (const ev of gen) results.push(ev);

    const done = results.find(
      (r) => (r as { type: string }).type === "done",
    ) as Record<string, unknown>;
    assert.ok(done);
    assert.equal(done.hasContent, false);
    assert.equal(done.contentChars, 0);
    assert.equal(done.finishReason, "stop");
  });

  it("reports reasoningChars and hasReasoning when reasoning is streamed", async () => {
    _mockEvents = async function* () {
      yield { type: "delta" as const, reasoning: "Let me think about this..." };
      yield { type: "delta" as const, text: "Here is the answer." };
      yield {
        type: "assistant_done" as const,
        content: "Here is the answer.",
        toolCalls: undefined,
        usage: { inputTokens: 15, outputTokens: 8 },
        finishReason: "stop",
      };
    };

    const results: unknown[] = [];
    const gen = generateWithToolsStream({
      messages: [{ role: "user", content: "hi" }],
      ctx: {},
      enableTools: false,
    });
    for await (const ev of gen) results.push(ev);

    const done = results.find(
      (r) => (r as { type: string }).type === "done",
    ) as Record<string, unknown>;
    assert.ok(done);
    assert.ok((done.reasoningChars as number) > 0);
    assert.equal(done.hasReasoning, true);
  });

  it("propagates reasoningTokens from provider assistant_done.usage to done event", async () => {
    _mockEvents = async function* () {
      yield {
        type: "assistant_done" as const,
        content: "Final answer.",
        toolCalls: undefined,
        usage: { inputTokens: 50, outputTokens: 20, reasoningTokens: 42 },
        finishReason: "stop",
      };
    };

    const results: unknown[] = [];
    const gen = generateWithToolsStream({
      messages: [{ role: "user", content: "hi" }],
      ctx: {},
      enableTools: false,
    });
    for await (const ev of gen) results.push(ev);

    const done = results.find(
      (r) => (r as { type: string }).type === "done",
    ) as Record<string, unknown>;
    assert.ok(done);
    assert.equal(
      done.reasoningTokens,
      42,
      "reasoningTokens from provider usage should appear on done event",
    );
  });

  it("tracks tool calls across rounds and reports empty content on final round", async () => {
    let round = 0;
    _mockEvents = async function* () {
      round++;
      if (round === 1) {
        yield {
          type: "assistant_done" as const,
          content: "",
          toolCalls: [{ id: "c1", name: "web_search", arguments: '{"q":"weather"}' }],
          usage: { inputTokens: 20, outputTokens: 15 },
          finishReason: "tool_calls",
        };
      } else {
        yield {
          type: "assistant_done" as const,
          content: "",
          toolCalls: undefined,
          usage: { inputTokens: 30, outputTokens: 5 },
          finishReason: "stop",
        };
      }
    };

    const results: unknown[] = [];
    const gen = generateWithToolsStream({
      messages: [{ role: "user", content: "test" }],
      ctx: { signal: new AbortController().signal },
      enableTools: true,
      allowedToolNames: ["nonexistent_tool"],
    });
    for await (const ev of gen) results.push(ev);

    // Tool events
    assert.equal(results.filter((r) => (r as { type: string }).type === "before_tool").length, 1);
    assert.equal(results.filter((r) => (r as { type: string }).type === "after_tool").length, 1);

    // Done event diagnostics
    const done = results.find(
      (r) => (r as { type: string }).type === "done",
    ) as Record<string, unknown>;
    assert.ok(done);
    assert.equal(done.content, "");
    assert.equal(done.finishReason, "stop");
    assert.equal(done.contentChars, 0);
    assert.equal(done.hasContent, false);
    assert.equal(done.toolCallCount, 1);
    assert.deepEqual(done.toolCallNames, ["web_search"]);
    assert.equal(done.maxTokens, env.GENERATION_MAX_TOKENS);
    assert.equal(done.generationRounds, 2);
  });
});

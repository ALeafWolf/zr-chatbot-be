import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import { streamOpenAICompatibleChat } from "./openaiStream";
import type { LLMUsage } from "./providerTypes";

// ---------------------------------------------------------------------------
// OpenAI streaming cached-input accumulation tests
//
// streamOpenAICompatibleChat accepts an OpenAI client directly, so we don't
// need a module-level test seam — just pass a mock client.
// ---------------------------------------------------------------------------

function mockChunk(overrides: {
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
  content?: string;
  finish_reason?: string | null;
}) {
  const usage =
    overrides.prompt_tokens !== undefined
      ? {
          prompt_tokens: overrides.prompt_tokens,
          completion_tokens: overrides.completion_tokens ?? 0,
          total_tokens: (overrides.prompt_tokens ?? 0) + (overrides.completion_tokens ?? 0),
          prompt_tokens_details:
            overrides.cached_tokens !== undefined
              ? { cached_tokens: overrides.cached_tokens }
              : undefined,
          completion_tokens_details:
            overrides.reasoning_tokens !== undefined
              ? { reasoning_tokens: overrides.reasoning_tokens }
              : undefined,
        }
      : undefined;

  return {
    id: "chunk_1",
    object: "chat.completion.chunk",
    created: 1_000_000,
    model: "gpt-5-nano",
    choices: [
      {
        index: 0,
        delta: {
          content: overrides.content ?? null,
          ...(overrides.reasoning_tokens !== undefined
            ? { reasoning_content: "thinking..." }
            : {}),
        },
        finish_reason: overrides.finish_reason ?? null,
      },
    ],
    usage: usage ?? null,
  };
}

/** Build an async iterable from an array of chunks. */
async function* chunksToStream<T>(
  chunks: T[],
): AsyncIterable<T> {
  for (const c of chunks) {
    yield c;
  }
}

describe("OpenAI stream — cached input token accumulation", () => {
  it("accumulates cachedInputTokens from the final chunk's usage", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () =>
            chunksToStream([
              mockChunk({ content: "Hello", finish_reason: null }),
              mockChunk({
                content: "",
                finish_reason: "stop",
                prompt_tokens: 100,
                completion_tokens: 50,
                cached_tokens: 30,
              }),
            ]),
        },
      },
    } as unknown as OpenAI;

    const events: unknown[] = [];
    for await (const ev of streamOpenAICompatibleChat(
      mockClient,
      "gpt-5-nano",
      [{ role: "user", content: "Hi" }],
    )) {
      events.push(ev);
    }

    assert.equal(events.length, 2);
    assert.equal((events[0] as { type: string }).type, "delta");

    const done = events[1] as { type: string; usage: LLMUsage };
    assert.equal(done.type, "assistant_done");
    assert.equal(done.usage.inputTokens, 100);
    assert.equal(done.usage.outputTokens, 50);
    assert.equal(done.usage.cachedInputTokens, 30);
  });

  it("accumulates reasoningTokens alongside cachedInputTokens", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () =>
            chunksToStream([
              mockChunk({ content: "Hi", finish_reason: null }),
              mockChunk({
                content: "",
                finish_reason: "stop",
                prompt_tokens: 200,
                completion_tokens: 80,
                cached_tokens: 50,
                reasoning_tokens: 20,
              }),
            ]),
        },
      },
    } as unknown as OpenAI;

    const events: unknown[] = [];
    for await (const ev of streamOpenAICompatibleChat(
      mockClient,
      "gpt-5-nano",
      [{ role: "user", content: "Hi" }],
    )) {
      events.push(ev);
    }

    const done = events[events.length - 1] as { type: string; usage: LLMUsage };
    assert.equal(done.usage.inputTokens, 200);
    assert.equal(done.usage.outputTokens, 80);
    assert.equal(done.usage.cachedInputTokens, 50);
    assert.equal(done.usage.reasoningTokens, 20);
  });

  it("omits cachedInputTokens when no caching occurred", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () =>
            chunksToStream([
              mockChunk({
                content: "No cache",
                finish_reason: "stop",
                prompt_tokens: 50,
                completion_tokens: 25,
              }),
            ]),
        },
      },
    } as unknown as OpenAI;

    const events: unknown[] = [];
    for await (const ev of streamOpenAICompatibleChat(
      mockClient,
      "gpt-5-nano",
      [{ role: "user", content: "Hi" }],
    )) {
      events.push(ev);
    }

    const done = events[events.length - 1] as { type: string; usage: LLMUsage };
    assert.equal(done.usage.cachedInputTokens, undefined);
  });

  it("passes through cached_tokens > prompt_tokens (malformed — no clamping)", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () =>
            chunksToStream([
              mockChunk({
                content: "Bad",
                finish_reason: "stop",
                prompt_tokens: 50,
                completion_tokens: 10,
                cached_tokens: 999, // malformed
              }),
            ]),
        },
      },
    } as unknown as OpenAI;

    const events: unknown[] = [];
    for await (const ev of streamOpenAICompatibleChat(
      mockClient,
      "gpt-5-nano",
      [{ role: "user", content: "Hi" }],
    )) {
      events.push(ev);
    }

    const done = events[events.length - 1] as { type: string; usage: LLMUsage };
    // Adapter passes through whatever the SDK reports
    assert.equal(done.usage.cachedInputTokens, 999);
  });
});

// ---------------------------------------------------------------------------
// DeepSeek-style streaming — flat cache hit/miss fields
// ---------------------------------------------------------------------------

/** Build a DeepSeek-shaped chunk. Returns `unknown` because its `usage`
 *  shape (flat `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`)
 *  differs from the OpenAI-shaped chunks used in the tests above. */
function mockDSChunk(overrides: {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  reasoning_tokens?: number;
  content?: string;
  finish_reason?: string | null;
}) {
  const usage =
    overrides.prompt_tokens !== undefined
      ? {
          prompt_tokens: overrides.prompt_tokens,
          completion_tokens: overrides.completion_tokens ?? 0,
          total_tokens: (overrides.prompt_tokens ?? 0) + (overrides.completion_tokens ?? 0),
          // DeepSeek flat cache fields — NOT nested
          prompt_cache_hit_tokens: overrides.prompt_cache_hit_tokens ?? null,
          prompt_cache_miss_tokens: overrides.prompt_cache_miss_tokens ?? null,
          completion_tokens_details:
            overrides.reasoning_tokens !== undefined
              ? { reasoning_tokens: overrides.reasoning_tokens }
              : undefined,
        }
      : undefined;

  return {
    id: "ds_chunk_1",
    object: "chat.completion.chunk",
    created: 1_000_000,
    model: "deepseek-v4-flash",
    choices: [
      {
        index: 0,
        delta: {
          content: overrides.content ?? null,
        },
        finish_reason: overrides.finish_reason ?? null,
      },
    ],
    usage: usage ?? null,
  };
}

describe("DeepSeek stream — flat cache hit/miss accumulation", () => {
  it("accumulates cacheHitInputTokens and cacheMissInputTokens from final chunk", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () =>
            chunksToStream([
              mockDSChunk({ content: "Hello", finish_reason: null }),
              mockDSChunk({
                content: "",
                finish_reason: "stop",
                prompt_tokens: 200,
                completion_tokens: 80,
                prompt_cache_hit_tokens: 150,
                prompt_cache_miss_tokens: 50,
              }),
            ]),
        },
      },
    } as unknown as OpenAI;

    const events: unknown[] = [];
    for await (const ev of streamOpenAICompatibleChat(
      mockClient,
      "deepseek-v4-flash",
      [{ role: "user", content: "Hi" }],
    )) {
      events.push(ev);
    }

    assert.equal(events.length, 2);
    const done = events[1] as { type: string; usage: LLMUsage };
    assert.equal(done.usage.cacheHitInputTokens, 150);
    assert.equal(done.usage.cacheMissInputTokens, 50);
  });

  it("accumulates reasoning tokens alongside cache hit/miss", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () =>
            chunksToStream([
              mockDSChunk({ content: "Hi", finish_reason: null }),
              mockDSChunk({
                content: "",
                finish_reason: "stop",
                prompt_tokens: 300,
                completion_tokens: 120,
                prompt_cache_hit_tokens: 100,
                prompt_cache_miss_tokens: 200,
                reasoning_tokens: 30,
              }),
            ]),
        },
      },
    } as unknown as OpenAI;

    const events: unknown[] = [];
    for await (const ev of streamOpenAICompatibleChat(
      mockClient,
      "deepseek-v4-flash",
      [{ role: "user", content: "Hi" }],
    )) {
      events.push(ev);
    }

    const done = events[events.length - 1] as { type: string; usage: LLMUsage };
    assert.equal(done.usage.cacheHitInputTokens, 100);
    assert.equal(done.usage.cacheMissInputTokens, 200);
    assert.equal(done.usage.reasoningTokens, 30);
  });

  it("omits cache fields when no caching occurred", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () =>
            chunksToStream([
              mockDSChunk({
                content: "No cache",
                finish_reason: "stop",
                prompt_tokens: 50,
                completion_tokens: 25,
              }),
            ]),
        },
      },
    } as unknown as OpenAI;

    const events: unknown[] = [];
    for await (const ev of streamOpenAICompatibleChat(
      mockClient,
      "deepseek-v4-flash",
      [{ role: "user", content: "Hi" }],
    )) {
      events.push(ev);
    }

    const done = events[events.length - 1] as { type: string; usage: LLMUsage };
    assert.equal(done.usage.cacheHitInputTokens, undefined);
    assert.equal(done.usage.cacheMissInputTokens, undefined);
  });
});

describe("OpenAI stream — max_completion_tokens detection", () => {
  it("sends max_completion_tokens for gpt-5-mini (reasoning model)", async () => {
    let capturedParams: Record<string, unknown> | undefined;
    const mockClient = {
      chat: {
        completions: {
          create: async (params: Record<string, unknown>) => {
            capturedParams = params;
            return chunksToStream([
              mockChunk({ content: "Hi", finish_reason: "stop", prompt_tokens: 10, completion_tokens: 5 }),
            ]);
          },
        },
      },
    } as unknown as OpenAI;

    const events: unknown[] = [];
    for await (const ev of streamOpenAICompatibleChat(
      mockClient,
      "gpt-5-mini",
      [{ role: "user", content: "Hi" }],
    )) {
      events.push(ev);
    }

    assert.ok(capturedParams);
    assert.equal(capturedParams.max_completion_tokens, 2048);
    assert.equal(capturedParams.max_tokens, undefined);
  });

  it("sends max_tokens for gpt-4o-mini (non-reasoning model)", async () => {
    let capturedParams: Record<string, unknown> | undefined;
    const mockClient = {
      chat: {
        completions: {
          create: async (params: Record<string, unknown>) => {
            capturedParams = params;
            return chunksToStream([
              mockChunk({ content: "Hi", finish_reason: "stop", prompt_tokens: 10, completion_tokens: 5 }),
            ]);
          },
        },
      },
    } as unknown as OpenAI;

    const events: unknown[] = [];
    for await (const ev of streamOpenAICompatibleChat(
      mockClient,
      "gpt-4o-mini",
      [{ role: "user", content: "Hi" }],
    )) {
      events.push(ev);
    }

    assert.ok(capturedParams);
    assert.equal(capturedParams.max_tokens, 2048);
    assert.equal(capturedParams.max_completion_tokens, undefined);
  });

  it("sends max_tokens for deepseek-v4-pro (regression guard)", async () => {
    let capturedParams: Record<string, unknown> | undefined;
    const mockClient = {
      chat: {
        completions: {
          create: async (params: Record<string, unknown>) => {
            capturedParams = params;
            return chunksToStream([
              mockChunk({ content: "Hi", finish_reason: "stop", prompt_tokens: 10, completion_tokens: 5 }),
            ]);
          },
        },
      },
    } as unknown as OpenAI;

    const events: unknown[] = [];
    for await (const ev of streamOpenAICompatibleChat(
      mockClient,
      "deepseek-v4-pro",
      [{ role: "user", content: "Hi" }],
    )) {
      events.push(ev);
    }

    assert.ok(capturedParams);
    // DeepSeek does NOT use max_completion_tokens — this is the regression guard
    assert.equal(capturedParams.max_tokens, 2048);
    assert.equal(capturedParams.max_completion_tokens, undefined);
  });
});

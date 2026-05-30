import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createDeepSeekProvider,
  __test_setClient,
} from "./deepseekProvider";
import type { LLMUsage } from "./providerTypes";

// ---------------------------------------------------------------------------
// DeepSeek provider cache hit/miss dimension tests (non-streaming)
// ---------------------------------------------------------------------------

function assertLLMUsage(
  actual: LLMUsage | undefined,
  expected: Partial<LLMUsage> & { inputTokens: number; outputTokens: number },
): void {
  assert.ok(actual, "usage should be defined");
  assert.equal(actual.inputTokens, expected.inputTokens);
  assert.equal(actual.outputTokens, expected.outputTokens);
  if (expected.cacheHitInputTokens !== undefined) {
    assert.equal(actual.cacheHitInputTokens, expected.cacheHitInputTokens);
  }
  if (expected.cacheMissInputTokens !== undefined) {
    assert.equal(actual.cacheMissInputTokens, expected.cacheMissInputTokens);
  }
  if (expected.reasoningTokens !== undefined) {
    assert.equal(actual.reasoningTokens, expected.reasoningTokens);
  }
}

function makeMockCompletion(overrides: {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  reasoning_tokens?: number;
}) {
  return {
    id: "mock-ds-cmpl-1",
    object: "chat.completion",
    created: 1_000_000,
    model: "deepseek-v4-flash",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "Hello",
          ...(overrides.reasoning_tokens !== undefined
            ? { reasoning_content: "thinking..." }
            : {}),
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: overrides.prompt_tokens,
      completion_tokens: overrides.completion_tokens,
      total_tokens: overrides.prompt_tokens + overrides.completion_tokens,
      prompt_cache_hit_tokens: overrides.prompt_cache_hit_tokens ?? null,
      prompt_cache_miss_tokens: overrides.prompt_cache_miss_tokens ?? null,
      completion_tokens_details: overrides.reasoning_tokens !== undefined
        ? { reasoning_tokens: overrides.reasoning_tokens }
        : undefined,
    },
  };
}

describe("DeepSeek provider — non-streaming cache hit/miss and reasoning tokens", () => {
  it("emits cache-hit only", async () => {
    __test_setClient({
      chat: {
        completions: {
          create: async () =>
            makeMockCompletion({
              prompt_tokens: 200,
              completion_tokens: 80,
              prompt_cache_hit_tokens: 200,
              prompt_cache_miss_tokens: 0,
            }),
        },
      },
    } as never);

    const provider = createDeepSeekProvider("deepseek-v4-flash");
    const result = await provider.chat([{ role: "user", content: "Hi" }]);
    assertLLMUsage(result.usage, {
      inputTokens: 200,
      outputTokens: 80,
      cacheHitInputTokens: 200,
      cacheMissInputTokens: 0,
    });
  });

  it("emits cache-miss only", async () => {
    __test_setClient({
      chat: {
        completions: {
          create: async () =>
            makeMockCompletion({
              prompt_tokens: 150,
              completion_tokens: 60,
              prompt_cache_hit_tokens: 0,
              prompt_cache_miss_tokens: 150,
            }),
        },
      },
    } as never);

    const provider = createDeepSeekProvider("deepseek-v4-flash");
    const result = await provider.chat([{ role: "user", content: "Hi" }]);
    assertLLMUsage(result.usage, {
      inputTokens: 150,
      outputTokens: 60,
      cacheHitInputTokens: 0,
      cacheMissInputTokens: 150,
    });
  });

  it("emits mixed cache-hit + cache-miss", async () => {
    __test_setClient({
      chat: {
        completions: {
          create: async () =>
            makeMockCompletion({
              prompt_tokens: 500,
              completion_tokens: 200,
              prompt_cache_hit_tokens: 150,
              prompt_cache_miss_tokens: 350,
            }),
        },
      },
    } as never);

    const provider = createDeepSeekProvider("deepseek-v4-flash");
    const result = await provider.chat([{ role: "user", content: "Hi" }]);
    assertLLMUsage(result.usage, {
      inputTokens: 500,
      outputTokens: 200,
      cacheHitInputTokens: 150,
      cacheMissInputTokens: 350,
    });
  });

  it("emits reasoning tokens alongside cache fields", async () => {
    __test_setClient({
      chat: {
        completions: {
          create: async () =>
            makeMockCompletion({
              prompt_tokens: 300,
              completion_tokens: 120,
              prompt_cache_hit_tokens: 100,
              prompt_cache_miss_tokens: 200,
              reasoning_tokens: 30,
            }),
        },
      },
    } as never);

    const provider = createDeepSeekProvider("deepseek-v4-flash");
    const result = await provider.chat([{ role: "user", content: "Hi" }]);
    assertLLMUsage(result.usage, {
      inputTokens: 300,
      outputTokens: 120,
      cacheHitInputTokens: 100,
      cacheMissInputTokens: 200,
      reasoningTokens: 30,
    });
    // reasoningContent (text) is separate from reasoningTokens (count)
    assert.equal(result.reasoningContent, "thinking...");
  });

  it("passes through any hit+miss combo without enforcing invariant", async () => {
    // DeepSeek docs guarantee hit + miss = total, but the adapter
    // should NOT enforce this — pass through whatever the API returns.
    __test_setClient({
      chat: {
        completions: {
          create: async () =>
            makeMockCompletion({
              prompt_tokens: 100,
              completion_tokens: 40,
              prompt_cache_hit_tokens: 999,
              prompt_cache_miss_tokens: 1,
              // 999 + 1 = 1000 ≠ 100 (malformed), but adapter passes through
            }),
        },
      },
    } as never);

    const provider = createDeepSeekProvider("deepseek-v4-flash");
    const result = await provider.chat([{ role: "user", content: "Hi" }]);
    assert.ok(result.usage);
    assert.equal(result.usage.cacheHitInputTokens, 999);
    assert.equal(result.usage.cacheMissInputTokens, 1);
  });

  it("omits cache fields entirely when none reported", async () => {
    __test_setClient({
      chat: {
        completions: {
          create: async () =>
            makeMockCompletion({
              prompt_tokens: 50,
              completion_tokens: 20,
              prompt_cache_hit_tokens: undefined,
              prompt_cache_miss_tokens: undefined,
            }),
        },
      },
    } as never);

    const provider = createDeepSeekProvider("deepseek-v4-flash");
    const result = await provider.chat([{ role: "user", content: "Hi" }]);
    assert.ok(result.usage);
    assert.equal(result.usage.cacheHitInputTokens, undefined);
    assert.equal(result.usage.cacheMissInputTokens, undefined);
  });
});

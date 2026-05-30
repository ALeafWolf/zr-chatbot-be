import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createOpenAIProvider,
  __test_setClient,
} from "./openaiProvider";
import type { LLMUsage } from "./providerTypes";

// ---------------------------------------------------------------------------
// OpenAI provider cache/reasoning dimension tests (non-streaming)
//
// Uses __test_setClient to inject a mock OpenAI client.
// ---------------------------------------------------------------------------

function assertLLMUsage(
  actual: LLMUsage | undefined,
  expected: Partial<LLMUsage> & { inputTokens: number; outputTokens: number },
): void {
  assert.ok(actual, "usage should be defined");
  assert.equal(actual.inputTokens, expected.inputTokens);
  assert.equal(actual.outputTokens, expected.outputTokens);
  if (expected.cachedInputTokens !== undefined) {
    assert.equal(actual.cachedInputTokens, expected.cachedInputTokens);
  }
  if (expected.reasoningTokens !== undefined) {
    assert.equal(actual.reasoningTokens, expected.reasoningTokens);
  }
}

function makeMockCompletion(overrides: {
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
}) {
  return {
    id: "mock-cmpl-1",
    object: "chat.completion",
    created: 1_000_000,
    model: "gpt-5-nano",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Hello" },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: overrides.prompt_tokens,
      completion_tokens: overrides.completion_tokens,
      total_tokens: overrides.prompt_tokens + overrides.completion_tokens,
      prompt_tokens_details: overrides.cached_tokens !== undefined
        ? { cached_tokens: overrides.cached_tokens }
        : undefined,
      completion_tokens_details: overrides.reasoning_tokens !== undefined
        ? { reasoning_tokens: overrides.reasoning_tokens }
        : undefined,
    },
  };
}

describe("OpenAI provider — non-streaming cached input and reasoning tokens", () => {
  it("emits cachedInputTokens and reasoningTokens when present", async () => {
    __test_setClient({
      chat: {
        completions: {
          create: async () =>
            makeMockCompletion({
              prompt_tokens: 100,
              completion_tokens: 50,
              cached_tokens: 30,
              reasoning_tokens: 10,
            }),
        },
      },
    } as never);

    const provider = createOpenAIProvider("gpt-5-nano");
    const result = await provider.chat([{ role: "user", content: "Hi" }]);
    assertLLMUsage(result.usage, {
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 30,
      reasoningTokens: 10,
    });
  });

  it("omits cachedInputTokens and reasoningTokens when absent", async () => {
    __test_setClient({
      chat: {
        completions: {
          create: async () =>
            makeMockCompletion({
              prompt_tokens: 200,
              completion_tokens: 80,
            }),
        },
      },
    } as never);

    const provider = createOpenAIProvider("gpt-5-nano");
    const result = await provider.chat([{ role: "user", content: "Hi" }]);
    assert.ok(result.usage);
    assert.equal(result.usage.cachedInputTokens, undefined);
    assert.equal(result.usage.reasoningTokens, undefined);
  });

  it("emits cachedInputTokens > prompt_tokens (malformed SDK — adapter passes through)", async () => {
    // Per review-007's informational: the adapter should not paper over
    // a malformed SDK response. This test documents that behavior.
    __test_setClient({
      chat: {
        completions: {
          create: async () =>
            makeMockCompletion({
              prompt_tokens: 50,
              completion_tokens: 20,
              cached_tokens: 999, // > prompt_tokens (malformed)
            }),
        },
      },
    } as never);

    const provider = createOpenAIProvider("gpt-5-nano");
    const result = await provider.chat([{ role: "user", content: "Hi" }]);
    assert.ok(result.usage);
    // Adapter passes through whatever the SDK reports — no clamping
    assert.equal(result.usage.cachedInputTokens, 999);
  });

  it("handles null usage gracefully", async () => {
    __test_setClient({
      chat: {
        completions: {
          create: async () => ({
            id: "mock-cmpl-2",
            object: "chat.completion",
            created: 1_000_000,
            model: "gpt-5-nano",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "" },
                finish_reason: "stop",
              },
            ],
            usage: null,
          }),
        },
      },
    } as never);

    const provider = createOpenAIProvider("gpt-5-nano");
    const result = await provider.chat([{ role: "user", content: "Hi" }]);
    assert.equal(result.inputTokens, 0);
    assert.equal(result.outputTokens, 0);
    assert.equal(result.usage, undefined);
  });
});

describe("OpenAI provider — max_completion_tokens detection", () => {
  it("sends max_completion_tokens for gpt-5-mini (reasoning model)", async () => {
    let capturedParams: Record<string, unknown> | undefined;
    __test_setClient({
      chat: {
        completions: {
          create: async (params: Record<string, unknown>) => {
            capturedParams = params;
            return makeMockCompletion({ prompt_tokens: 10, completion_tokens: 5 });
          },
        },
      },
    } as never);

    const provider = createOpenAIProvider("gpt-5-mini");
    await provider.chat([{ role: "user", content: "Hi" }]);
    assert.ok(capturedParams);
    assert.equal(capturedParams.max_completion_tokens, 2048);
    assert.equal(capturedParams.max_tokens, undefined);
  });

  it("sends max_tokens for gpt-4o-mini (non-reasoning model)", async () => {
    let capturedParams: Record<string, unknown> | undefined;
    __test_setClient({
      chat: {
        completions: {
          create: async (params: Record<string, unknown>) => {
            capturedParams = params;
            return makeMockCompletion({ prompt_tokens: 10, completion_tokens: 5 });
          },
        },
      },
    } as never);

    const provider = createOpenAIProvider("gpt-4o-mini");
    await provider.chat([{ role: "user", content: "Hi" }]);
    assert.ok(capturedParams);
    assert.equal(capturedParams.max_tokens, 2048);
    assert.equal(capturedParams.max_completion_tokens, undefined);
  });

  it("adds reasoning_effort default for gpt-5-mini with no caller extensions", async () => {
    let capturedParams: Record<string, unknown> | undefined;
    __test_setClient({
      chat: {
        completions: {
          create: async (params: Record<string, unknown>) => {
            capturedParams = params;
            return makeMockCompletion({ prompt_tokens: 10, completion_tokens: 5 });
          },
        },
      },
    } as never);

    const provider = createOpenAIProvider("gpt-5-mini");
    await provider.chat([{ role: "user", content: "Hi" }]);
    assert.ok(capturedParams);
    assert.equal(capturedParams.reasoning_effort, "low");
  });

  it("respects caller-supplied reasoning_effort override", async () => {
    let capturedParams: Record<string, unknown> | undefined;
    __test_setClient({
      chat: {
        completions: {
          create: async (params: Record<string, unknown>) => {
            capturedParams = params;
            return makeMockCompletion({ prompt_tokens: 10, completion_tokens: 5 });
          },
        },
      },
    } as never);

    const provider = createOpenAIProvider("gpt-5-mini");
    await provider.chat([{ role: "user", content: "Hi" }], {
      openAICompatibleRequestExtensions: { reasoning_effort: "high" },
    });
    assert.ok(capturedParams);
    assert.equal(capturedParams.reasoning_effort, "high");
  });

  it("omits reasoning_effort for gpt-4o-mini (non-reasoning model)", async () => {
    let capturedParams: Record<string, unknown> | undefined;
    __test_setClient({
      chat: {
        completions: {
          create: async (params: Record<string, unknown>) => {
            capturedParams = params;
            return makeMockCompletion({ prompt_tokens: 10, completion_tokens: 5 });
          },
        },
      },
    } as never);

    const provider = createOpenAIProvider("gpt-4o-mini");
    await provider.chat([{ role: "user", content: "Hi" }]);
    assert.ok(capturedParams);
    assert.equal(capturedParams.reasoning_effort, undefined);
  });
});

describe("OpenAI provider — temperature omission for reasoning models", () => {
  it("omits temperature for gpt-5-mini (reasoning model)", async () => {
    let capturedParams: Record<string, unknown> | undefined;
    __test_setClient({
      chat: { completions: { create: async (params: Record<string, unknown>) => { capturedParams = params; return makeMockCompletion({ prompt_tokens: 10, completion_tokens: 5 }); } } },
    } as never);
    const provider = createOpenAIProvider("gpt-5-mini");
    await provider.chat([{ role: "user", content: "Hi" }]);
    assert.ok(capturedParams);
    assert.equal("temperature" in capturedParams, false);
  });

  it("includes temperature for gpt-5-mini even when reasoning-effort already covers it", async () => {
    let capturedParams: Record<string, unknown> | undefined;
    __test_setClient({
      chat: { completions: { create: async (params: Record<string, unknown>) => { capturedParams = params; return makeMockCompletion({ prompt_tokens: 10, completion_tokens: 5 }); } } },
    } as never);
    const provider = createOpenAIProvider("gpt-5-mini");
    await provider.chat([{ role: "user", content: "Hi" }]);
    assert.ok(capturedParams);
    assert.equal("temperature" in capturedParams, false);
  });

  it("includes temperature for gpt-4o-mini (non-reasoning model)", async () => {
    let capturedParams: Record<string, unknown> | undefined;
    __test_setClient({
      chat: { completions: { create: async (params: Record<string, unknown>) => { capturedParams = params; return makeMockCompletion({ prompt_tokens: 10, completion_tokens: 5 }); } } },
    } as never);
    const provider = createOpenAIProvider("gpt-4o-mini");
    await provider.chat([{ role: "user", content: "Hi" }]);
    assert.ok(capturedParams);
    assert.equal(capturedParams.temperature, 1.0);
  });
});

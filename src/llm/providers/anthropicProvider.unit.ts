import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createAnthropicProvider,
  __test_setClient,
} from "./anthropicProvider";
import type { LLMUsage } from "./providerTypes";

// ---------------------------------------------------------------------------
// Anthropic provider cache dimension tests
//
// We use __test_setClient to inject a mock client into the provider module.
// Each test sets the mock response before calling chat() / streamChat().
// ---------------------------------------------------------------------------

type MockUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  /** TTL-split object — only present on non-streaming responses. */
  cache_creation?: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  } | null;
};

type MockMessageResponse = {
  content: Array<{ type: string; text: string }>;
  stop_reason: string;
  usage: MockUsage;
};

/** Mutable response — each test updates this before calling the provider. */
let _mockResponse: MockMessageResponse;

// Create a mock stream that yields the mock response as finalMessage.
function createMockStream() {
  const iterable: AsyncIterable<unknown> = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return { done: true, value: undefined } as IteratorResult<unknown>;
        },
      };
    },
  };
  return Object.assign(iterable, {
    async finalMessage(): Promise<MockMessageResponse> {
      return _mockResponse;
    },
  });
}

function makeMockUsage(overrides: Partial<MockUsage> & { input_tokens: number; output_tokens: number }): MockUsage {
  return {
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    cache_creation: null,
    ...overrides,
  };
}

function assertLLMUsage(
  actual: LLMUsage | undefined,
  expected: Partial<LLMUsage> & { inputTokens: number; outputTokens: number },
): void {
  assert.ok(actual, "usage should be defined");
  assert.equal(actual.inputTokens, expected.inputTokens);
  assert.equal(actual.outputTokens, expected.outputTokens);
  if (expected.cacheReadInputTokens !== undefined) {
    assert.equal(actual.cacheReadInputTokens, expected.cacheReadInputTokens);
  }
  if (expected.cacheCreationInputTokens !== undefined) {
    assert.equal(actual.cacheCreationInputTokens, expected.cacheCreationInputTokens);
  }
  if (expected.cacheCreation5mTokens !== undefined) {
    assert.equal(actual.cacheCreation5mTokens, expected.cacheCreation5mTokens);
  }
  if (expected.cacheCreation1hTokens !== undefined) {
    assert.equal(actual.cacheCreation1hTokens, expected.cacheCreation1hTokens);
  }
}

describe("Anthropic provider — non-streaming cache dimensions", () => {
  it("emits cache-write 5m only from non-streaming chat", async () => {
    __test_setClient({
      messages: {
        create: async () => ({
          content: [{ type: "text", text: "Hello" }],
          stop_reason: "end_turn",
          usage: makeMockUsage({
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 80,
            cache_read_input_tokens: null,
            cache_creation: {
              ephemeral_5m_input_tokens: 80,
              ephemeral_1h_input_tokens: 0,
            },
          }),
        }),
        stream: () => { throw new Error("not used"); },
      },
    } as never);

    const provider = createAnthropicProvider("claude-sonnet-4-5");
    const result = await provider.chat([{ role: "user", content: "Hi" }]);
    assertLLMUsage(result.usage, {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: undefined,
      cacheCreationInputTokens: 80,
      cacheCreation5mTokens: 80,
      cacheCreation1hTokens: 0,
    });
  });

  it("emits cache-write 1h only from non-streaming chat", async () => {
    __test_setClient({
      messages: {
        create: async () => ({
          content: [{ type: "text", text: "Hello" }],
          stop_reason: "end_turn",
          usage: makeMockUsage({
            input_tokens: 200,
            output_tokens: 100,
            cache_creation_input_tokens: 150,
            cache_read_input_tokens: null,
            cache_creation: {
              ephemeral_5m_input_tokens: 0,
              ephemeral_1h_input_tokens: 150,
            },
          }),
        }),
        stream: () => { throw new Error("not used"); },
      },
    } as never);

    const provider = createAnthropicProvider("claude-sonnet-4-5");
    const result = await provider.chat([{ role: "user", content: "Hi" }]);
    assertLLMUsage(result.usage, {
      inputTokens: 200,
      outputTokens: 100,
      cacheReadInputTokens: undefined,
      cacheCreationInputTokens: 150,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 150,
    });
  });

  it("emits mixed cache-write 5m+1h from non-streaming chat", async () => {
    __test_setClient({
      messages: {
        create: async () => ({
          content: [{ type: "text", text: "Hello" }],
          stop_reason: "end_turn",
          usage: makeMockUsage({
            input_tokens: 500,
            output_tokens: 200,
            cache_creation_input_tokens: 400,
            cache_read_input_tokens: 30,
            cache_creation: {
              ephemeral_5m_input_tokens: 300,
              ephemeral_1h_input_tokens: 100,
            },
          }),
        }),
        stream: () => { throw new Error("not used"); },
      },
    } as never);

    const provider = createAnthropicProvider("claude-sonnet-4-5");
    const result = await provider.chat([{ role: "user", content: "Hi" }]);
    assertLLMUsage(result.usage, {
      inputTokens: 500,
      outputTokens: 200,
      cacheReadInputTokens: 30,
      cacheCreationInputTokens: 400,
      cacheCreation5mTokens: 300,
      cacheCreation1hTokens: 100,
    });
  });

  it("emits cache-read only (no writes) from non-streaming chat", async () => {
    __test_setClient({
      messages: {
        create: async () => ({
          content: [{ type: "text", text: "Hello" }],
          stop_reason: "end_turn",
          usage: makeMockUsage({
            input_tokens: 300,
            output_tokens: 150,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: 200,
            cache_creation: null,
          }),
        }),
        stream: () => { throw new Error("not used"); },
      },
    } as never);

    const provider = createAnthropicProvider("claude-sonnet-4-5");
    const result = await provider.chat([{ role: "user", content: "Hi" }]);
    assertLLMUsage(result.usage, {
      inputTokens: 300,
      outputTokens: 150,
      cacheReadInputTokens: 200,
      cacheCreationInputTokens: undefined,
      cacheCreation5mTokens: undefined,
      cacheCreation1hTokens: undefined,
    });
  });
});

describe("Anthropic provider — streaming cache dimensions", () => {
  it("emits cache_creation sum only (no TTL split) from streaming", async () => {
    __test_setClient({
      messages: {
        create: () => { throw new Error("not used"); },
        stream: () => {
          _mockResponse = {
            content: [{ type: "text", text: "Hello" }],
            stop_reason: "end_turn",
            usage: makeMockUsage({
              input_tokens: 100,
              output_tokens: 50,
              cache_creation_input_tokens: 80,
              cache_read_input_tokens: 20,
              // No cache_creation TTL split on streaming path
              cache_creation: null,
            }),
          };
          return createMockStream();
        },
      },
    } as never);

    const provider = createAnthropicProvider("claude-sonnet-4-5");
    const events: unknown[] = [];
    for await (const ev of provider.streamChat([{ role: "user", content: "Hi" }])) {
      events.push(ev);
    }

    assert.equal(events.length, 1);
    const doneEvent = events[0] as { type: string; usage: LLMUsage };
    assert.equal(doneEvent.type, "assistant_done");

    assertLLMUsage(doneEvent.usage, {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 20,
      cacheCreationInputTokens: 80,
      cacheCreation5mTokens: undefined,
      cacheCreation1hTokens: undefined,
    });
  });

  it("omits cache fields entirely when no caching occurred", async () => {
    __test_setClient({
      messages: {
        create: () => { throw new Error("not used"); },
        stream: () => {
          _mockResponse = {
            content: [{ type: "text", text: "No cache" }],
            stop_reason: "end_turn",
            usage: makeMockUsage({
              input_tokens: 50,
              output_tokens: 25,
              cache_creation_input_tokens: null,
              cache_read_input_tokens: null,
            }),
          };
          return createMockStream();
        },
      },
    } as never);

    const provider = createAnthropicProvider("claude-sonnet-4-5");
    const events: unknown[] = [];
    for await (const ev of provider.streamChat([{ role: "user", content: "Hi" }])) {
      events.push(ev);
    }

    const doneEvent = events[0] as { type: string; usage: LLMUsage };
    assert.equal(doneEvent.type, "assistant_done");
    assert.equal(doneEvent.usage.cacheReadInputTokens, undefined);
    assert.equal(doneEvent.usage.cacheCreationInputTokens, undefined);
  });
});

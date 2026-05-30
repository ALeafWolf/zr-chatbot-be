import { describe, it, afterEach, mock } from "node:test";
import assert from "node:assert";
import { z } from "zod";
import { isFallbackableLlmError, parseJsonStreamResult } from "./index";

const TestSchema = z.object({
  selected: z.array(z.object({ id: z.string() })),
  rejected: z.array(z.object({ id: z.string() })),
  finalContextMode: z.string(),
  needsEvidenceFallback: z.boolean(),
});

describe("parseJsonStreamResult finishReason preservation", () => {
  it("preserves finishReason on JSON parse failure", () => {
    const raw = "Some assistant text without JSON delimiters.";
    const result = parseJsonStreamResult(raw, 100, 20, "stop", TestSchema);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.finishReason, "stop", "finishReason should be preserved on parse failure");
      assert.equal(result.error, "No JSON object/array found");
      assert.equal(result.inputTokens, 100);
      assert.equal(result.outputTokens, 20);
    }
  });

  it("preserves finishReason on Zod schema validation failure", () => {
    const raw = '{"selected": "not_an_array"}';
    const result = parseJsonStreamResult(raw, 200, 30, "length", TestSchema);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.finishReason, "length", "finishReason should be preserved on schema failure");
      assert.equal(result.inputTokens, 200);
      assert.equal(result.outputTokens, 30);
    }
  });

  it("returns finishReason undefined when finishReason was not emitted", () => {
    const raw = "some non-json text";
    const result = parseJsonStreamResult(raw, 50, 5, undefined, TestSchema);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.finishReason, undefined);
    }
  });

  it("does not include finishReason on success path", () => {
    const raw = JSON.stringify({
      selected: [{ id: "mem_1" }],
      rejected: [],
      finalContextMode: "recent_only",
      needsEvidenceFallback: false,
    });
    const result = parseJsonStreamResult(raw, 300, 40, "stop", TestSchema);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal("finishReason" in result, false, "success path should not include finishReason");
    }
  });
});

import { buildChatJsonOptions } from "./index";

describe("buildChatJsonOptions", () => {
  it("forwards openAICompatibleRequestExtensions when provided", () => {
    const result = buildChatJsonOptions({
      maxTokens: 4096,
      temperature: 0.3,
      openAICompatibleRequestExtensions: { thinking: { type: "disabled" } },
    });
    assert.deepEqual(result.openAICompatibleRequestExtensions, { thinking: { type: "disabled" } });
  });

  it("omits openAICompatibleRequestExtensions when undefined", () => {
    const result = buildChatJsonOptions({ maxTokens: 4096 });
    assert.equal(result.openAICompatibleRequestExtensions, undefined);
  });

  it("preserves jsonMode true", () => {
    const result = buildChatJsonOptions({});
    assert.equal(result.jsonMode, true);
  });

  it("preserves signal when provided", () => {
    const controller = new AbortController();
    const result = buildChatJsonOptions({ signal: controller.signal });
    assert.equal(result.signal, controller.signal);
  });
});

describe("isFallbackableLlmError", () => {
  it("matches rate limits, server errors, and network-style failures", () => {
    assert.equal(isFallbackableLlmError({ status: 429 }), true);
    assert.equal(isFallbackableLlmError({ status: 503 }), true);
    assert.equal(isFallbackableLlmError(Object.assign(new Error("fetch failed"), { code: "ECONNRESET" })), true);
  });

  it("does not match client/auth errors or caller-aborted signals", () => {
    assert.equal(isFallbackableLlmError({ status: 401 }), false);
    const controller = new AbortController();
    controller.abort();
    assert.equal(isFallbackableLlmError(new Error("aborted"), controller.signal), false);
  });
});

const ScenarioSchema = z.object({ ok: z.boolean() });

/**
 * Helper: create a mock LLMProvider with controlled chat/streamChat behavior.
 */
function mockProvider(behavior: {
  throwError?: unknown;
  content?: string;
  inputTokens?: number;
  outputTokens?: number;
}) {
  const content = behavior.content ?? JSON.stringify({ ok: true });
  const inputTokens = behavior.inputTokens ?? 100;
  const outputTokens = behavior.outputTokens ?? 50;
  const err = behavior.throwError;
  return {
    chat: async () => {
      if (err) throw err;
      return { content, inputTokens, outputTokens, finishReason: "stop" as const };
    },
    streamChat: async function* () {
      if (err) throw err;
      yield {
        type: "assistant_done" as const,
        content,
        usage: { inputTokens, outputTokens },
        finishReason: "stop" as const,
      };
    },
  };
}

describe("chatJsonWithFallback", () => {
  afterEach(async () => {
    const { __testables__ } = await import("./index");
    __testables__.setMockProvider(undefined);
  });

  it("primary parse failure → fallback success", async () => {
    let callIndex = 0;
    const { __testables__, chatJsonWithFallback: fn } = await import("./index");
    __testables__.setMockProvider(() => {
      callIndex++;
      return callIndex === 1
        ? mockProvider({ content: "not-json" })
        : mockProvider({ content: JSON.stringify({ ok: true }) });
    });
    const result = await fn(
      { provider: "openai", model: "gpt-5-nano" },
      { provider: "openai", model: "gpt-5-mini" },
      [{ role: "user", content: "test" }],
      ScenarioSchema,
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.ok, true);
    assert.equal(result.binding.model, "gpt-5-mini");
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.fallbackAttempts.length, 1);
    assert.equal(result.fallbackAttempts[0]!.trigger, "parse_failure");
    assert.equal(result.fallbackAttempts[0]!.inputTokens, 100);
    assert.equal(result.fallbackAttempts[0]!.outputTokens, 50);
  });

  it("primary 429 → fallback success", async () => {
    let callIndex = 0;
    const { __testables__, chatJsonWithFallback: fn } = await import("./index");
    __testables__.setMockProvider(() => {
      callIndex++;
      return callIndex === 1
        ? mockProvider({ throwError: Object.assign(new Error("Rate limit"), { status: 429 }) })
        : mockProvider({});
    });
    const result = await fn(
      { provider: "openai", model: "gpt-5-nano" },
      { provider: "openai", model: "gpt-5-mini" },
      [{ role: "user", content: "test" }],
      ScenarioSchema,
    );
    assert.equal(result.ok, true);
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.fallbackAttempts.length, 1);
    assert.equal(result.fallbackAttempts[0]!.trigger, "rate_limit");
  });

  it("primary 503 → fallback success", async () => {
    let callIndex = 0;
    const { __testables__, chatJsonWithFallback: fn } = await import("./index");
    __testables__.setMockProvider(() => {
      callIndex++;
      return callIndex === 1
        ? mockProvider({ throwError: Object.assign(new Error("Overloaded"), { status: 503 }) })
        : mockProvider({});
    });
    const result = await fn(
      { provider: "openai", model: "gpt-5-nano" },
      { provider: "openai", model: "gpt-5-mini" },
      [{ role: "user", content: "test" }],
      ScenarioSchema,
    );
    assert.equal(result.ok, true);
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.fallbackAttempts[0]!.trigger, "server_error");
  });

  it("primary network error → fallback success", async () => {
    let callIndex = 0;
    const { __testables__, chatJsonWithFallback: fn } = await import("./index");
    __testables__.setMockProvider(() => {
      callIndex++;
      return callIndex === 1
        ? mockProvider({ throwError: Object.assign(new Error("fetch failed"), { code: "ECONNRESET" }) })
        : mockProvider({});
    });
    const result = await fn(
      { provider: "openai", model: "gpt-5-nano" },
      { provider: "openai", model: "gpt-5-mini" },
      [{ role: "user", content: "test" }],
      ScenarioSchema,
    );
    assert.equal(result.ok, true);
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.fallbackAttempts[0]!.trigger, "network_error");
  });

  it("primary 401 → no fallback, rethrows", async () => {
    const { __testables__, chatJsonWithFallback: fn } = await import("./index");
    __testables__.setMockProvider(() =>
      mockProvider({ throwError: Object.assign(new Error("Unauthorized"), { status: 401 }) }),
    );
    await assert.rejects(
      fn(
        { provider: "openai", model: "gpt-5-nano" },
        { provider: "openai", model: "gpt-5-mini" },
        [{ role: "user", content: "test" }],
        ScenarioSchema,
      ),
      (err: Error) => {
        assert.match(err.message, /Unauthorized/i);
        return true;
      },
    );
  });

  it("aborted signal → no fallback", async () => {
    const controller = new AbortController();
    controller.abort();
    const { __testables__, chatJsonWithFallback: fn } = await import("./index");
    __testables__.setMockProvider(() =>
      mockProvider({ throwError: Object.assign(new Error("server error"), { status: 500 }) }),
    );
    await assert.rejects(
      fn(
        { provider: "openai", model: "gpt-5-nano" },
        { provider: "openai", model: "gpt-5-mini" },
        [{ role: "user", content: "test" }],
        ScenarioSchema,
        { signal: controller.signal },
      ),
    );
  });

  it("duplicate fallback binding → silently skipped", async () => {
    let callCount = 0;
    const { __testables__, chatJsonWithFallback: fn } = await import("./index");
    __testables__.setMockProvider(() => {
      callCount++;
      return mockProvider({});
    });
    const result = await fn(
      { provider: "openai", model: "gpt-5-nano" },
      { provider: "openai", model: "gpt-5-nano" },
      [{ role: "user", content: "test" }],
      ScenarioSchema,
    );
    assert.equal(result.ok, true);
    assert.equal(result.fallbackUsed, false);
    assert.equal(result.fallbackAttempts.length, 0);
    assert.equal(callCount, 1);
  });
});

describe("chatJsonStreamWithFallback", () => {
  afterEach(async () => {
    const { __testables__ } = await import("./index");
    __testables__.setMockProvider(undefined);
  });

  it("primary parse failure → fallback success", async () => {
    let callIndex = 0;
    const { __testables__, chatJsonStreamWithFallback: fn } = await import("./index");
    __testables__.setMockProvider(() => {
      callIndex++;
      return callIndex === 1
        ? mockProvider({ content: "not-json" })
        : mockProvider({ content: JSON.stringify({ ok: true }) });
    });
    const result = await fn(
      { provider: "openai", model: "gpt-5-nano" },
      { provider: "openai", model: "gpt-5-mini" },
      [{ role: "user", content: "test" }],
      ScenarioSchema,
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.ok, true);
    assert.equal(result.binding.model, "gpt-5-mini");
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.fallbackAttempts.length, 1);
    assert.equal(result.fallbackAttempts[0]!.trigger, "parse_failure");
  });

  it("primary 429 → fallback success", async () => {
    let callIndex = 0;
    const { __testables__, chatJsonStreamWithFallback: fn } = await import("./index");
    __testables__.setMockProvider(() => {
      callIndex++;
      return callIndex === 1
        ? mockProvider({ throwError: Object.assign(new Error("Rate limit"), { status: 429 }) })
        : mockProvider({});
    });
    const result = await fn(
      { provider: "openai", model: "gpt-5-nano" },
      { provider: "openai", model: "gpt-5-mini" },
      [{ role: "user", content: "test" }],
      ScenarioSchema,
    );
    assert.equal(result.ok, true);
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.fallbackAttempts[0]!.trigger, "rate_limit");
  });

  it("primary 503 → fallback success", async () => {
    let callIndex = 0;
    const { __testables__, chatJsonStreamWithFallback: fn } = await import("./index");
    __testables__.setMockProvider(() => {
      callIndex++;
      return callIndex === 1
        ? mockProvider({ throwError: Object.assign(new Error("Overloaded"), { status: 503 }) })
        : mockProvider({});
    });
    const result = await fn(
      { provider: "openai", model: "gpt-5-nano" },
      { provider: "openai", model: "gpt-5-mini" },
      [{ role: "user", content: "test" }],
      ScenarioSchema,
    );
    assert.equal(result.ok, true);
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.fallbackAttempts[0]!.trigger, "server_error");
  });

  it("primary network error → fallback success", async () => {
    let callIndex = 0;
    const { __testables__, chatJsonStreamWithFallback: fn } = await import("./index");
    __testables__.setMockProvider(() => {
      callIndex++;
      return callIndex === 1
        ? mockProvider({ throwError: Object.assign(new Error("fetch failed"), { code: "ECONNRESET" }) })
        : mockProvider({});
    });
    const result = await fn(
      { provider: "openai", model: "gpt-5-nano" },
      { provider: "openai", model: "gpt-5-mini" },
      [{ role: "user", content: "test" }],
      ScenarioSchema,
    );
    assert.equal(result.ok, true);
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.fallbackAttempts[0]!.trigger, "network_error");
  });

  it("primary 401 → no fallback, rethrows", async () => {
    const { __testables__, chatJsonStreamWithFallback: fn } = await import("./index");
    __testables__.setMockProvider(() =>
      mockProvider({ throwError: Object.assign(new Error("Unauthorized"), { status: 401 }) }),
    );
    await assert.rejects(
      fn(
        { provider: "openai", model: "gpt-5-nano" },
        { provider: "openai", model: "gpt-5-mini" },
        [{ role: "user", content: "test" }],
        ScenarioSchema,
      ),
      (err: Error) => {
        assert.match(err.message, /Unauthorized/i);
        return true;
      },
    );
  });

  it("aborted signal → no fallback", async () => {
    const controller = new AbortController();
    controller.abort();
    const { __testables__, chatJsonStreamWithFallback: fn } = await import("./index");
    __testables__.setMockProvider(() =>
      mockProvider({ throwError: Object.assign(new Error("server error"), { status: 500 }) }),
    );
    await assert.rejects(
      fn(
        { provider: "openai", model: "gpt-5-nano" },
        { provider: "openai", model: "gpt-5-mini" },
        [{ role: "user", content: "test" }],
        ScenarioSchema,
        { signal: controller.signal },
      ),
    );
  });

  it("duplicate fallback binding → silently skipped", async () => {
    let callCount = 0;
    const { __testables__, chatJsonStreamWithFallback: fn } = await import("./index");
    __testables__.setMockProvider(() => {
      callCount++;
      return mockProvider({});
    });
    const result = await fn(
      { provider: "openai", model: "gpt-5-nano" },
      { provider: "openai", model: "gpt-5-nano" },
      [{ role: "user", content: "test" }],
      ScenarioSchema,
    );
    assert.equal(result.ok, true);
    assert.equal(result.fallbackUsed, false);
    assert.equal(result.fallbackAttempts.length, 0);
    assert.equal(callCount, 1);
  });
});

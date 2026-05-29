import { describe, it } from "node:test";
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

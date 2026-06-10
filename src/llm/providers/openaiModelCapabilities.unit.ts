import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { requiresMaxCompletionTokens } from "./openaiModelCapabilities";

describe("requiresMaxCompletionTokens", () => {
  it("returns true for reasoning families (gpt-5, o1, o3, o4), false for non-reasoning (gpt-4, gpt-3.5, deepseek), handles edge cases", () => {
    // Reasoning → true
    assert.equal(requiresMaxCompletionTokens("gpt-5"), true, "gpt-5 base");
    assert.equal(requiresMaxCompletionTokens("gpt-5-mini"), true, "gpt-5-mini");
    assert.equal(requiresMaxCompletionTokens("gpt-5-nano"), true, "gpt-5-nano");
    assert.equal(requiresMaxCompletionTokens("gpt-5-pro"), true, "gpt-5-pro");
    assert.equal(requiresMaxCompletionTokens("o1"), true, "o1");
    assert.equal(requiresMaxCompletionTokens("o1-mini"), true, "o1-mini");
    assert.equal(requiresMaxCompletionTokens("o1-preview"), true, "o1-preview");
    assert.equal(requiresMaxCompletionTokens("o1-pro"), true, "o1-pro");
    assert.equal(requiresMaxCompletionTokens("o3"), true, "o3");
    assert.equal(requiresMaxCompletionTokens("o3-mini"), true, "o3-mini");
    assert.equal(requiresMaxCompletionTokens("o3-pro"), true, "o3-pro");
    assert.equal(requiresMaxCompletionTokens("o4-mini"), true, "o4-mini");
    assert.equal(requiresMaxCompletionTokens("o4-mini-high"), true, "o4-mini-high");
    // Non-reasoning → false
    assert.equal(requiresMaxCompletionTokens("gpt-4"), false, "gpt-4");
    assert.equal(requiresMaxCompletionTokens("gpt-4o"), false, "gpt-4o");
    assert.equal(requiresMaxCompletionTokens("gpt-4o-mini"), false, "gpt-4o-mini");
    assert.equal(requiresMaxCompletionTokens("gpt-4-turbo"), false, "gpt-4-turbo");
    assert.equal(requiresMaxCompletionTokens("gpt-3.5-turbo"), false, "gpt-3.5");
    assert.equal(requiresMaxCompletionTokens("deepseek-chat"), false, "deepseek-chat");
    assert.equal(requiresMaxCompletionTokens("deepseek-v4-pro"), false, "deepseek-v4-pro");
    assert.equal(requiresMaxCompletionTokens("deepseek-v4-flash"), false, "deepseek-v4-flash");
    // Edge cases
    assert.equal(requiresMaxCompletionTokens("gpt-50"), false, "gpt-50 (hypothetical)");
    assert.equal(requiresMaxCompletionTokens("o10"), false, "o10 (hypothetical)");
    assert.equal(requiresMaxCompletionTokens("gpt-5.1"), true, "gpt-5.1 (future dotted)");
    assert.equal(requiresMaxCompletionTokens("o1.1"), true, "o1.1 (future dotted)");
  });
});

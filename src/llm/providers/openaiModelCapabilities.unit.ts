import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { requiresMaxCompletionTokens } from "./openaiModelCapabilities";

describe("requiresMaxCompletionTokens", () => {
  // Reasoning families → true
  it("returns true for gpt-5 family", () => {
    assert.equal(requiresMaxCompletionTokens("gpt-5"), true);
    assert.equal(requiresMaxCompletionTokens("gpt-5-mini"), true);
    assert.equal(requiresMaxCompletionTokens("gpt-5-nano"), true);
    assert.equal(requiresMaxCompletionTokens("gpt-5-pro"), true);
  });

  it("returns true for o1 family", () => {
    assert.equal(requiresMaxCompletionTokens("o1"), true);
    assert.equal(requiresMaxCompletionTokens("o1-mini"), true);
    assert.equal(requiresMaxCompletionTokens("o1-preview"), true);
    assert.equal(requiresMaxCompletionTokens("o1-pro"), true);
  });

  it("returns true for o3 family", () => {
    assert.equal(requiresMaxCompletionTokens("o3"), true);
    assert.equal(requiresMaxCompletionTokens("o3-mini"), true);
    assert.equal(requiresMaxCompletionTokens("o3-pro"), true);
  });

  it("returns true for o4 family", () => {
    assert.equal(requiresMaxCompletionTokens("o4-mini"), true);
    assert.equal(requiresMaxCompletionTokens("o4-mini-high"), true);
  });

  // Non-reasoning OpenAI families → false
  it("returns false for gpt-4 family", () => {
    assert.equal(requiresMaxCompletionTokens("gpt-4"), false);
    assert.equal(requiresMaxCompletionTokens("gpt-4o"), false);
    assert.equal(requiresMaxCompletionTokens("gpt-4o-mini"), false);
    assert.equal(requiresMaxCompletionTokens("gpt-4-turbo"), false);
  });

  it("returns false for gpt-3.5 family", () => {
    assert.equal(requiresMaxCompletionTokens("gpt-3.5-turbo"), false);
  });

  // DeepSeek models → false (regression guard)
  it("returns false for DeepSeek models", () => {
    assert.equal(requiresMaxCompletionTokens("deepseek-chat"), false);
    assert.equal(requiresMaxCompletionTokens("deepseek-v4-pro"), false);
    assert.equal(requiresMaxCompletionTokens("deepseek-v4-flash"), false);
  });

  // Edge cases
  it("does not match hypothetical gpt-50 or o10 (family boundary anchor)", () => {
    assert.equal(requiresMaxCompletionTokens("gpt-50"), false);
    assert.equal(requiresMaxCompletionTokens("o10"), false);
  });

  it("handles dotted versioned names correctly", () => {
    // If gpt-5.1 or o1.1 appear in the future, they should match
    assert.equal(requiresMaxCompletionTokens("gpt-5.1"), true);
    assert.equal(requiresMaxCompletionTokens("o1.1"), true);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzePromptBlocks,
  buildPromptTracePayload,
  estimateTextTokens,
  hashTraceText,
  hasRawSensitiveTraceKeys,
} from "./tracePayloads";

describe("trace payload helpers", () => {
  it("estimates text tokens from character count", () => {
    assert.equal(estimateTextTokens(""), 0);
    assert.equal(estimateTextTokens("a"), 1);
    assert.equal(estimateTextTokens("abcd"), 1);
    assert.equal(estimateTextTokens("abcde"), 2);
  });

  it("hashes trace text deterministically", () => {
    assert.equal(hashTraceText("same"), hashTraceText("same"));
    assert.notEqual(hashTraceText("same"), hashTraceText("different"));
  });

  it("counts prompt block families without keeping raw prompt text", () => {
    const payload = buildPromptTracePayload({
      systemPrompt: "[SYSTEM]\nabcde\n\n[CANON NARRATIVE]\ncanon",
      conversationHistory: [{ role: "user", content: "hello" }],
      retrievedCanonNarrative: "canon",
    });

    assert.equal(payload.blockPresence.SYSTEM, true);
    assert.equal(payload.blockPresence["CANON NARRATIVE"], true);
    assert.equal(payload.estimatedTokensByBlock.SYSTEM, 2);
    assert.equal(payload.conversationMessageCount, 1);
    assert.equal(hasRawSensitiveTraceKeys(payload), false);
  });

  it("analyzes prompt blocks", () => {
    assert.deepEqual(analyzePromptBlocks("[A]\none\n\n[B]\ntwo").map((b) => b.label), [
      "A",
      "B",
    ]);
  });
});

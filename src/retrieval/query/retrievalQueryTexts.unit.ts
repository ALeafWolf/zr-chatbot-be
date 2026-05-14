import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRetrievalQueryTexts } from "./retrievalQueryTexts";
import type { QueryRewriteResult } from "./rewriteQuery";

function query(overrides: Partial<QueryRewriteResult>): QueryRewriteResult {
  return {
    segments: [],
    combined_for_embedding: "",
    entities: [],
    intent: "general",
    confidence: 0.9,
    structuralParseOk: true,
    labelOk: true,
    parseOk: true,
    ...overrides,
  };
}

describe("buildRetrievalQueryTexts", () => {
  it("routes speech action and thought into memory query", () => {
    const result = buildRetrievalQueryTexts({
      userMessage: "raw",
      queryRewrite: query({
        segments: [
          { lane: "user_speech", text: "hello" },
          { lane: "user_action", text: "waves" },
          { lane: "user_thought", text: "nervous" },
        ],
      }),
      options: { annotationFallback: false, confidenceThreshold: 0.6 },
    });

    assert.equal(result.memoryText, "hello\nwaves\nnervous");
  });

  it("omits reply directions unless no other memory text exists", () => {
    const withSpeech = buildRetrievalQueryTexts({
      userMessage: "raw fallback",
      queryRewrite: query({
        segments: [
          { lane: "reply_direction", text: "be romantic" },
          { lane: "user_speech", text: "remember this" },
        ],
      }),
      options: { annotationFallback: false, confidenceThreshold: 0.6 },
    });
    assert.equal(withSpeech.memoryText, "remember this");
    assert.equal(withSpeech.canonText, "remember this");

    const onlyDirection = buildRetrievalQueryTexts({
      userMessage: "[be romantic]",
      queryRewrite: query({
        segments: [{ lane: "reply_direction", text: "be romantic" }],
      }),
      options: { annotationFallback: false, confidenceThreshold: 0.6 },
    });
    assert.equal(onlyDirection.memoryText, "[be romantic]");
  });

  it("enables raw memory fusion for low confidence or failed parse", () => {
    assert.equal(
      buildRetrievalQueryTexts({
        userMessage: "raw",
        queryRewrite: query({
          confidence: 0.2,
          segments: [{ lane: "user_speech", text: "rewritten" }],
        }),
        options: { annotationFallback: false, confidenceThreshold: 0.6 },
      }).shouldFuseRawMemory,
      true,
    );

    assert.equal(
      buildRetrievalQueryTexts({
        userMessage: "raw",
        queryRewrite: query({ parseOk: false }),
        options: { annotationFallback: false, confidenceThreshold: 0.6 },
      }).shouldFuseRawMemory,
      true,
    );
  });

  it("keeps high-confidence rewrites on single-query retrieval", () => {
    assert.equal(
      buildRetrievalQueryTexts({
        userMessage: "raw",
        queryRewrite: query({
          confidence: 0.95,
          segments: [{ lane: "user_speech", text: "rewritten" }],
        }),
        options: { annotationFallback: false, confidenceThreshold: 0.6 },
      }).shouldFuseRawMemory,
      false,
    );
  });
});

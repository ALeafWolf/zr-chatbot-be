import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractReplyDirections, serializeSegmentsForPrompt } from "./generationUserMessage";
import type { QuerySegment } from "../../retrieval/query/rewriteQuery";

// ---------------------------------------------------------------------------
// extractReplyDirections — deterministic phase-A extraction of 【】 spans
// ---------------------------------------------------------------------------

describe("extractReplyDirections", () => {
  it("mid-text 【】: strips direction, preserves surrounding text", () => {
    const result = extractReplyDirections("你好【温柔点】吗？");
    assert.equal(result.applied, true);
    assert.equal(result.strippedMessage, "你好吗？");
    assert.deepEqual(result.replyDirections, ["温柔点"]);
  });

  it("multiple 【】 spans: strips all, returns all inner texts in order", () => {
    const result = extractReplyDirections("【A】你好【B】吗？");
    assert.equal(result.applied, true);
    assert.equal(result.strippedMessage, "你好吗？");
    assert.deepEqual(result.replyDirections, ["A", "B"]);
  });

  it("leading 【】 spans before plain text", () => {
    const result = extractReplyDirections("【请温柔】你好。");
    assert.equal(result.applied, true);
    assert.equal(result.strippedMessage, "你好。");
    assert.deepEqual(result.replyDirections, ["请温柔"]);
  });

  it("trailing 【】 spans after plain text", () => {
    const result = extractReplyDirections("你好。【温柔点】");
    assert.equal(result.applied, true);
    assert.equal(result.strippedMessage, "你好。");
    assert.deepEqual(result.replyDirections, ["温柔点"]);
  });

  it("only-【】 message returns placeholder user turn", () => {
    const result = extractReplyDirections("【请温柔回应】");
    assert.equal(result.applied, true);
    assert.equal(
      result.strippedMessage,
      "（用户本轮没有场景内发言，仅提供了场外指示。）",
    );
    assert.deepEqual(result.replyDirections, ["请温柔回应"]);
  });

  it("only-【】 with whitespace only returns placeholder", () => {
    const result = extractReplyDirections("【A】  ");
    assert.equal(result.applied, true);
    assert.equal(
      result.strippedMessage,
      "（用户本轮没有场景内发言，仅提供了场外指示。）",
    );
  });

  it("no 【】 spans ⇒ applied: false, message unchanged", () => {
    const result = extractReplyDirections("你好吗？");
    assert.equal(result.applied, false);
    assert.equal(result.strippedMessage, "你好吗？");
    assert.deepEqual(result.replyDirections, []);
  });

  it("structural parse failure (unbalanced 【) ⇒ applied: false, raw message returned", () => {
    const result = extractReplyDirections("你好【温柔");
    assert.equal(result.applied, false);
    assert.equal(result.strippedMessage, "你好【温柔");
    assert.deepEqual(result.replyDirections, []);
  });

  it("structural parse failure (nested 【) ⇒ applied: false", () => {
    const result = extractReplyDirections("【外层【内层】】");
    assert.equal(result.applied, false);
    assert.equal(result.strippedMessage, "【外层【内层】】");
    assert.deepEqual(result.replyDirections, []);
  });

  it("structural parse failure (unbalanced paren) ⇒ applied: false", () => {
    const result = extractReplyDirections("（括号不匹配【方向】");
    assert.equal(result.applied, false);
    assert.equal(result.strippedMessage, "（括号不匹配【方向】");
  });

  it("empty string ⇒ applied: false", () => {
    const result = extractReplyDirections("");
    assert.equal(result.applied, false);
    assert.equal(result.strippedMessage, "");
    assert.deepEqual(result.replyDirections, []);
  });

  it("halfwidth () preserved verbatim in strippedMessage", () => {
    const result = extractReplyDirections("(心想) 你好【温柔】吗？");
    assert.equal(result.applied, true);
    assert.equal(result.strippedMessage, "(心想) 你好吗？");
  });

  it("fullwidth （） preserved verbatim in strippedMessage", () => {
    const result = extractReplyDirections("（心想）你好【温柔】吗？");
    assert.equal(result.applied, true);
    assert.equal(result.strippedMessage, "（心想）你好吗？");
  });

  it("mixed halfwidth/fullwidth parens preserved alongside 【】 stripping", () => {
    const result = extractReplyDirections("（hello）中文(english)【方向】end");
    assert.equal(result.applied, true);
    assert.equal(result.strippedMessage, "（hello）中文(english)end");
  });

  it("【】 only between text preserves surrounding text verbatim", () => {
    const result = extractReplyDirections("前段【指示】后段");
    assert.equal(result.applied, true);
    assert.equal(result.strippedMessage, "前段后段");
    assert.deepEqual(result.replyDirections, ["指示"]);
  });
});

// ---------------------------------------------------------------------------
// serializeSegmentsForPrompt — segments to structured query block
// ---------------------------------------------------------------------------

describe("serializeSegmentsForPrompt", () => {
  it("excludes reply_direction lanes", () => {
    const segments: QuerySegment[] = [
      { lane: "user_speech", text: "你好" },
      { lane: "reply_direction", text: "请温柔" },
    ];
    const result = serializeSegmentsForPrompt(segments);
    assert.equal(result.includes("[reply direction suggestion]:"), false);
    assert.equal(result.includes("[user speech]: 你好"), true);
  });

  it("returns empty string when only reply_direction segments exist", () => {
    const segments: QuerySegment[] = [
      { lane: "reply_direction", text: "请温柔" },
      { lane: "reply_direction", text: "再热情点" },
    ];
    assert.equal(serializeSegmentsForPrompt(segments), "");
  });

  it("returns empty string for empty input", () => {
    assert.equal(serializeSegmentsForPrompt([]), "");
  });

  it("renders user_speech, user_action, user_thought with correct headers", () => {
    const segments: QuerySegment[] = [
      { lane: "user_action", text: "点头" },
      { lane: "user_speech", text: "你好" },
      { lane: "user_thought", text: "他今天看起来不错" },
    ];
    const result = serializeSegmentsForPrompt(segments);
    assert.ok(result.includes("[user action]: 点头"));
    assert.ok(result.includes("[user speech]: 你好"));
    assert.ok(result.includes("[user thought]: 他今天看起来不错"));
  });

  it("ignores reply_direction in mixed segments, preserves order", () => {
    const segments: QuerySegment[] = [
      { lane: "user_speech", text: "早上好" },
      { lane: "reply_direction", text: "冷淡回应" },
      { lane: "user_speech", text: "今天天气不错" },
    ];
    const result = serializeSegmentsForPrompt(segments);
    const lines = result.split("\n");
    assert.equal(lines.length, 2, "two lines after filtering");
    assert.ok(lines[0]!.includes("早上好"));
    assert.ok(lines[1]!.includes("今天天气不错"));
  });
});

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
// relabelReplyDirectionsForHistory — prior turn 【】 → （场外指示：…）
// ---------------------------------------------------------------------------

import { relabelReplyDirectionsForHistory } from "./generationUserMessage";

describe("relabelReplyDirectionsForHistory", () => {
  it("relabels 【】 to （场外指示：…） in a mixed turn", () => {
    const result = relabelReplyDirectionsForHistory("你好【请温柔】吗？");
    assert.equal(result, "你好（场外指示：请温柔）吗？");
  });

  it("relabels each 【】 span in order for multiple directions", () => {
    const result = relabelReplyDirectionsForHistory("【A】text【B】");
    assert.equal(result, "（场外指示：A）text（场外指示：B）");
  });

  it("direction-only turn becomes non-empty （场外指示：…）", () => {
    const result = relabelReplyDirectionsForHistory("【请温柔回应】");
    assert.equal(result, "（场外指示：请温柔回应）");
  });

  it("no 【】 spans returns input unchanged", () => {
    const result = relabelReplyDirectionsForHistory("你好吗？");
    assert.equal(result, "你好吗？");
  });

  it("parse failure (unbalanced 【) returns input unchanged", () => {
    const result = relabelReplyDirectionsForHistory("你好【不平衡");
    assert.equal(result, "你好【不平衡");
  });

  it("empty string returns empty string", () => {
    const result = relabelReplyDirectionsForHistory("");
    assert.equal(result, "");
  });

  it("fullwidth/halfwidth paren content in non-square spans preserved verbatim", () => {
    const result = relabelReplyDirectionsForHistory("（心想）你好【方向】吗？(hello)");
    assert.equal(result, "（心想）你好（场外指示：方向）吗？(hello)");
  });
});

// ---------------------------------------------------------------------------
// serializeSegmentsForPrompt — segments to structured query block
// ---------------------------------------------------------------------------

describe("serializeSegmentsForPrompt", () => {
  it("includes reply_direction lanes in original order", () => {
    const segments: QuerySegment[] = [
      { lane: "user_speech", text: "你好" },
      { lane: "reply_direction", text: "请温柔" },
    ];
    const result = serializeSegmentsForPrompt(segments);
    // reply_direction is now included (TG3 order preservation)
    assert.ok(result.includes("[reply direction suggestion]:"), "reply_direction included");
    assert.ok(result.includes("[user speech]: 你好"), "user_speech included");
    // Verify order: speech first, then direction
    const speechIdx = result.indexOf("[user speech]");
    const dirIdx = result.indexOf("[reply direction suggestion]");
    assert.ok(speechIdx < dirIdx, "preserves original order");
  });

  it("direction-only input produces non-empty block", () => {
    const segments: QuerySegment[] = [
      { lane: "reply_direction", text: "请温柔" },
      { lane: "reply_direction", text: "再热情点" },
    ];
    const result = serializeSegmentsForPrompt(segments);
    assert.ok(result.length > 0, "non-empty for direction-only");
    assert.ok(result.includes("[reply direction suggestion]: 请温柔"), "first direction");
    assert.ok(result.includes("[reply direction suggestion]: 再热情点"), "second direction");
  });

  it("returns empty string for empty input", () => {
    assert.equal(serializeSegmentsForPrompt([]), "");
  });

  it("renders all lane types with correct headers", () => {
    const segments: QuerySegment[] = [
      { lane: "user_action", text: "点头" },
      { lane: "reply_direction", text: "请温柔" },
      { lane: "user_speech", text: "你好" },
      { lane: "user_thought", text: "他今天看起来不错" },
    ];
    const result = serializeSegmentsForPrompt(segments);
    assert.ok(result.includes("[user action]: 点头"));
    assert.ok(result.includes("[reply direction suggestion]: 请温柔"));
    assert.ok(result.includes("[user speech]: 你好"));
    assert.ok(result.includes("[user thought]: 他今天看起来不错"));
  });

  it("preserves original segment order with direction in middle", () => {
    const segments: QuerySegment[] = [
      { lane: "user_speech", text: "早上好" },
      { lane: "reply_direction", text: "冷淡回应" },
      { lane: "user_speech", text: "今天天气不错" },
    ];
    const result = serializeSegmentsForPrompt(segments);
    const lines = result.split("\n");
    assert.equal(lines.length, 3, "three lines — all segments included");
    assert.ok(lines[0]!.includes("早上好"), "first: speech");
    assert.ok(lines[1]!.includes("[reply direction suggestion]:"), "second: direction");
    assert.ok(lines[2]!.includes("今天天气不错"), "third: speech");
  });

  it("direction-before-speech ordering preserved", () => {
    const segments: QuerySegment[] = [
      { lane: "reply_direction", text: "处理好葱姜后做菜" },
      { lane: "user_speech", text: "谢谢老公~" },
      { lane: "user_action", text: "亲了口左然回去继续认真做菜" },
    ];
    const result = serializeSegmentsForPrompt(segments);
    const lines = result.split("\n");
    assert.ok(lines[0]!.includes("[reply direction suggestion]:"), "direction first");
    assert.ok(lines[1]!.includes("[user speech]:"), "speech second");
    assert.ok(lines[2]!.includes("[user action]:"), "action third");
  });
});

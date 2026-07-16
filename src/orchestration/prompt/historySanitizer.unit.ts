import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  sanitizeAssistantHistory,
  isBannedParentheticalSpan,
} from "./historySanitizer";

describe("historySanitizer", () => {
  describe("sanitizeAssistantHistory", () => {
    it("strips （心想：...） span", () => {
      const result = sanitizeAssistantHistory(
        "（心想：这是什么）正文内容",
      );
      assert.equal(result, "正文内容");
    });

    it("strips （内心：...） span", () => {
      const result = sanitizeAssistantHistory(
        "（内心：不对劲）他沉默了片刻。",
      );
      assert.equal(result, "他沉默了片刻。");
    });

    it("strips multiple banned spans", () => {
      const result = sanitizeAssistantHistory(
        "（心想：第一段）（内心：第二段）正文",
      );
      assert.equal(result, "正文");
    });

    it("preserves short action parentheticals", () => {
      const result = sanitizeAssistantHistory(
        "（停顿片刻）他垂下眼。",
      );
      assert.equal(result, "（停顿片刻）他垂下眼。");
    });

    it("preserves non-心想/内心 parentheticals", () => {
      const result = sanitizeAssistantHistory(
        "（轻声）他说。（微笑）",
      );
      assert.equal(result, "（轻声）他说。（微笑）");
    });

    it("handles mixed content with both types of parens", () => {
      const result = sanitizeAssistantHistory(
        "（心想：分析模式）正文（停顿）继续（内心：反思）结束",
      );
      // Only the 心想： and 内心： spans should be stripped
      assert.equal(result, "正文（停顿）继续结束");
    });

    it("handles empty string", () => {
      assert.equal(sanitizeAssistantHistory(""), "");
    });

    it("handles text without any parentheses", () => {
      assert.equal(
        sanitizeAssistantHistory("普通对话文本"),
        "普通对话文本",
      );
    });

    it("trims whitespace after stripping", () => {
      const result = sanitizeAssistantHistory(
        "（心想：测试）  末尾文本  ",
      );
      assert.equal(result, "末尾文本");
    });

    it("preserves English parentheticals", () => {
      const result = sanitizeAssistantHistory(
        "(thinking) 正文 (pause)",
      );
      // English parens () are not matched by the Chinese-paren regex
      assert.equal(result, "(thinking) 正文 (pause)");
    });
  });

  describe("isBannedParentheticalSpan", () => {
    it("returns true for 心想： span", () => {
      assert.equal(isBannedParentheticalSpan("心想：这是什么"), true);
    });

    it("returns true for 内心： span", () => {
      assert.equal(isBannedParentheticalSpan("内心：不对劲"), true);
    });

    it("returns false for action parenthetical", () => {
      assert.equal(isBannedParentheticalSpan("停顿片刻"), false);
    });

    it("returns false for empty string", () => {
      assert.equal(isBannedParentheticalSpan(""), false);
    });
  });
});

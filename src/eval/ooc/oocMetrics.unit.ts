import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLINICAL_WORDS,
  splitSentences,
  extractParentheticalSpans,
  isXiangXinNeiXinSpan,
  countLongParentheticalMonologue,
  countClinicalWordHits,
  computeClinicalWordDensity,
  computeShortSentenceRatio,
  countLiteralXiangXinNeiXinHits,
  computeOocPerTurnMetrics,
  computeAggregateMetrics,
} from "./oocMetrics";
import type { OocPerTurnMetrics } from "./replayTypes";

describe("oocMetrics", () => {
  describe("splitSentences", () => {
    it("splits Chinese sentences on 。", () => {
      assert.deepEqual(splitSentences("你好。世界。"), ["你好", "世界"]);
    });

    it("splits on ！ and ？", () => {
      assert.deepEqual(splitSentences("你好吗？我很好！"), ["你好吗", "我很好"]);
    });

    it("splits on English punctuation", () => {
      assert.deepEqual(splitSentences("Hello.World."), ["Hello", "World"]);
    });

    it("handles empty text", () => {
      assert.deepEqual(splitSentences(""), []);
    });

    it("handles text without sentence terminators", () => {
      assert.deepEqual(splitSentences("单一长句无标点"), ["单一长句无标点"]);
    });
  });

  describe("extractParentheticalSpans", () => {
    it("extracts Chinese parentheses", () => {
      const spans = extractParentheticalSpans(
        "（心想：这是什么）（内心：不对劲）正文",
      );
      assert.deepEqual(spans, ["心想：这是什么", "内心：不对劲"]);
    });

    it("extracts English parentheses", () => {
      const spans = extractParentheticalSpans("(test) text (hello)");
      assert.deepEqual(spans, ["test", "hello"]);
    });

    it("returns empty array when no parentheses", () => {
      assert.deepEqual(extractParentheticalSpans("普通文本"), []);
    });

    it("handles nested-like parentheses by matching innermost span", () => {
      // The regex does not support nesting; it matches the innermost balanced
      // pair because [^（）]* stops at any paren character.
      const spans = extractParentheticalSpans("（外层（内层））");
      assert.equal(spans.length, 1);
      // Only the innermost span "内层" is captured
      assert.equal(spans[0], "内层");
    });
  });

  describe("isXiangXinNeiXinSpan", () => {
    it("detects 心想： span", () => {
      assert.equal(isXiangXinNeiXinSpan("心想：这是什么"), true);
    });

    it("detects 内心： span", () => {
      assert.equal(isXiangXinNeiXinSpan("内心：不对劲"), true);
    });

    it("rejects non-心想/内心 span", () => {
      assert.equal(isXiangXinNeiXinSpan("停顿片刻"), false);
    });

    it("trims whitespace", () => {
      assert.equal(isXiangXinNeiXinSpan("  心想：测试"), true);
    });
  });

  describe("countLongParentheticalMonologue", () => {
    it("counts ≥30 Chinese-char parenthetical spans", () => {
      // 30 Chinese chars inside parens
      const longSpan = "（" + "字".repeat(30) + "）";
      assert.equal(countLongParentheticalMonologue(longSpan), 1);
    });

    it("ignores short parenthetical spans", () => {
      const shortSpan = "（短）";
      assert.equal(countLongParentheticalMonologue(shortSpan), 0);
    });

    it("counts multiple long spans", () => {
      const text =
        "（" + "字".repeat(30) + "）正文（" + "字".repeat(35) + "）";
      assert.equal(countLongParentheticalMonologue(text), 2);
    });

    it("handles empty text", () => {
      assert.equal(countLongParentheticalMonologue(""), 0);
    });
  });

  describe("countClinicalWordHits", () => {
    it("counts clinical words in text without overlapping double-counts", () => {
      const text = "胚胎发育和解剖学对称性";
      // 胚胎:1, 解剖:1, 对称性:1 (longer term "对称性" takes priority, no double-count of "对称")
      assert.equal(countClinicalWordHits(text), 3);
    });

    it("does not double-count overlapping terms at same position", () => {
      // "对称性" contains "对称" — should count as 1, not 2
      assert.equal(countClinicalWordHits("对称性"), 1);
      // Separate occurrences each count once
      assert.equal(countClinicalWordHits("对称性对称"), 2);
    });

    it("counts multiple occurrences of same word", () => {
      const text = "G点和G点";
      assert.equal(countClinicalWordHits(text), 2);
    });

    it("returns 0 for clean text", () => {
      assert.equal(countClinicalWordHits("你还好吗？"), 0);
    });

    it("includes all CLINICAL_WORDS in the list", () => {
      assert.ok(CLINICAL_WORDS.length > 10);
      assert.ok(CLINICAL_WORDS.includes("胚胎"));
      assert.ok(CLINICAL_WORDS.includes("解剖"));
      assert.ok(CLINICAL_WORDS.includes("对称"));
    });
  });

  describe("computeClinicalWordDensity", () => {
    it("computes hits per 1000 chars", () => {
      // 2 hits in 500 chars → 4.0 per 1000
      const text = "胚胎".repeat(250); // 500 chars, 250 hits
      const density = computeClinicalWordDensity(text);
      assert.ok(density > 0);
    });

    it("returns 0 for empty text", () => {
      assert.equal(computeClinicalWordDensity(""), 0);
    });
  });

  describe("computeShortSentenceRatio", () => {
    it("computes ratio of short Chinese sentences", () => {
      // "是" (1 char) is short, "你好世界" (4 chars) is short, "这是一个长句子" (6 chars) is not
      const text = "是。你好世界。这是一个长句子。";
      const ratio = computeShortSentenceRatio(text);
      // 2 out of 3 sentences are short
      assert.equal(ratio, 2 / 3);
    });

    it("returns 0 for empty text", () => {
      assert.equal(computeShortSentenceRatio(""), 0);
    });

    it("handles empty text", () => {
      assert.equal(computeShortSentenceRatio(""), 0);
    });

    it("handles text with no sentence terminators", () => {
      // A single block of text without 。！？ counts as one sentence
      // with 4 Chinese chars (< 5), so ratio is 1 (short)
      assert.equal(computeShortSentenceRatio("只有文本"), 1);
    });
  });

  describe("countLiteralXiangXinNeiXinHits", () => {
    it("counts 心想 occurrences", () => {
      assert.equal(countLiteralXiangXinNeiXinHits("心想心想"), 2);
    });

    it("counts 内心 occurrences", () => {
      assert.equal(countLiteralXiangXinNeiXinHits("内心独白"), 1);
    });

    it("counts mixed occurrences", () => {
      assert.equal(
        countLiteralXiangXinNeiXinHits("（心想：）（内心：）"),
        2,
      );
    });

    it("returns 0 when absent", () => {
      assert.equal(countLiteralXiangXinNeiXinHits("普通文本"), 0);
    });
  });

  describe("computeOocPerTurnMetrics", () => {
    it("computes all metrics for a clean reply", () => {
      const metrics = computeOocPerTurnMetrics(
        "他沉默了片刻。\n（停顿）\n“……好。",
        260,
      );
      assert.equal(metrics.turnIndex, 260);
      // "他沉默了片刻。\n（停顿）\n“……好。" = 18 chars (two … are each 1 char)
      assert.equal(metrics.replyLength, 18);
      assert.equal(metrics.sentenceCount, 2);
      assert.equal(metrics.clinicalWordHits, 0);
      assert.equal(metrics.longParentheticalMonologueCount, 0);
      assert.equal(metrics.literalXiangXinNeiXinHits, 0);
    });

    it("detects clinical words in OOC-style reply", () => {
      // Use a long parenthetical (≥30 Chinese chars) to satisfy the threshold
      const longParen = "（心想：" + "字".repeat(30) + "）";
      const oocReply =
        longParen +
        "从解剖学数据来看，这是定义明确的。";
      const metrics = computeOocPerTurnMetrics(oocReply, 281);
      assert.ok(metrics.clinicalWordHits > 0, "should detect clinical words");
      assert.ok(
        metrics.longParentheticalMonologueCount > 0,
        "should detect long monologue",
      );
      assert.ok(
        metrics.literalXiangXinNeiXinHits > 0,
        "should detect 心想/内心",
      );
    });
  });

  describe("computeAggregateMetrics", () => {
    const fakePerTurn: OocPerTurnMetrics[] = [
      {
        turnIndex: 260,
        replyLength: 300,
        sentenceCount: 5,
        shortSentenceRatio: 0.2,
        clinicalWordHits: 0,
        clinicalWordDensity: 0,
        longParentheticalMonologueCount: 0,
        parentheticalSpanCount: 1,
        literalXiangXinNeiXinHits: 0,
      },
      {
        turnIndex: 261,
        replyLength: 700,
        sentenceCount: 10,
        shortSentenceRatio: 0.3,
        clinicalWordHits: 3,
        clinicalWordDensity: 4.29,
        longParentheticalMonologueCount: 2,
        parentheticalSpanCount: 3,
        literalXiangXinNeiXinHits: 1,
      },
    ];

    it("computes aggregate from per-turn array", () => {
      const agg = computeAggregateMetrics(fakePerTurn, "raw");
      assert.equal(agg.turnCount, 2);
      assert.equal(agg.variant, "raw");
      assert.equal(agg.totalClinicalWordHits, 3);
      assert.equal(agg.totalLongParentheticalMonologue, 2);
      assert.equal(agg.turnsWithLongMonologue, 1);
      assert.equal(agg.turnsWithClinicalWords, 1);
      assert.equal(agg.minReplyLength, 300);
      assert.equal(agg.maxReplyLength, 700);
    });

    it("computes median correctly for even count", () => {
      const agg = computeAggregateMetrics(fakePerTurn, "raw");
      assert.equal(agg.medianReplyLength, 500); // (300 + 700) / 2
    });

    it("computes median correctly for odd count", () => {
      const agg = computeAggregateMetrics(
        [
          ...fakePerTurn,
          { ...fakePerTurn[0], turnIndex: 262, replyLength: 400 },
        ],
        "raw",
      );
      assert.equal(agg.medianReplyLength, 400); // sorted: 300, 400, 700
    });
  });
});

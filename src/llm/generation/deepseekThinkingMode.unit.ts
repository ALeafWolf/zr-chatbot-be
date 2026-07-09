import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendDeepSeekThinkingMarker,
  getDeepSeekThinkingMarker,
  hasDeepSeekThinkingMarker,
  isDeepSeekV4ProGenerationModel,
  stripDeepSeekThinkingMarkerPreview,
  INNER_OS_MARKER,
  NO_INNER_OS_MARKER,
} from "./deepseekThinkingMode";

const v4ProModel = { provider: "deepseek" as const, model: "deepseek-v4-pro" };
const anthropicModel = { provider: "anthropic" as const, model: "claude-sonnet-4-5" };
const openaiModel = { provider: "openai" as const, model: "gpt-4o" };
const deepseekFlashModel = { provider: "deepseek" as const, model: "deepseek-v4-flash" };

describe("deepseek thinking mode helper", () => {
  describe("isDeepSeekV4ProGenerationModel", () => {
    it("returns correct result per model", () => {
      const cases = [
        { name: "v4-pro", model: v4ProModel, expected: true },
        { name: "anthropic", model: anthropicModel, expected: false },
        { name: "openai", model: openaiModel, expected: false },
        { name: "deepseek-v4-flash", model: deepseekFlashModel, expected: false },
      ];
      for (const c of cases) {
        assert.equal(isDeepSeekV4ProGenerationModel(c.model), c.expected, c.name);
      }
    });
  });

  describe("getDeepSeekThinkingMarker", () => {
    it("returns correct marker per mode", () => {
      const cases = [
        { name: "inner_os", mode: "inner_os" as const, expected: INNER_OS_MARKER },
        { name: "no_inner_os", mode: "no_inner_os" as const, expected: NO_INNER_OS_MARKER },
        { name: "default", mode: "default" as const, expected: "" },
      ];
      for (const c of cases) {
        assert.equal(getDeepSeekThinkingMarker(c.mode), c.expected, c.name);
      }
    });
  });

  describe("hasDeepSeekThinkingMarker", () => {
    it("detects markers and returns false for plain content", () => {
      const cases = [
        { name: "inner_os marker", input: INNER_OS_MARKER, expected: true },
        { name: "no_inner_os marker", input: NO_INNER_OS_MARKER, expected: true },
        { name: "plain content", input: "你好。", expected: false },
      ];
      for (const c of cases) {
        assert.equal(hasDeepSeekThinkingMarker(c.input), c.expected, c.name);
      }
    });
  });

  describe("stripDeepSeekThinkingMarkerPreview", () => {
    it("strips markers and passes through plain/empty content", () => {
      const cases = [
        { name: "inner_os", input: `你好。${INNER_OS_MARKER}`, expected: "你好。", notIncludes: "【角色沉浸要求】" },
        { name: "no_inner_os", input: `你好。${NO_INNER_OS_MARKER}`, expected: "你好。", notIncludes: "【思维模式要求】" },
        { name: "plain", input: "你好。", expected: "你好。" },
        { name: "empty", input: "", expected: "" },
      ];
      for (const c of cases) {
        const r = stripDeepSeekThinkingMarkerPreview(c.input);
        assert.equal(r, c.expected, `${c.name} — content`);
        if (c.notIncludes) assert.ok(!r.includes(c.notIncludes), `${c.name} — stripped`);
      }
    });
  });

  describe("TG1.1 — INNER_OS_MARKER output-isolation constraint", () => {
    it("contains 【正文隔离约束】 block", () => {
      assert.ok(
        INNER_OS_MARKER.includes("【正文隔离约束】"),
        "must contain the output-isolation block",
      );
    });

    it("bans 心想/内心-lead parentheticals but preserves short action parens", () => {
      // Banned patterns
      assert.ok(
        INNER_OS_MARKER.includes("（心想："),
        "bans （心想： pattern",
      );
      assert.ok(
        INNER_OS_MARKER.includes("（内心："),
        "bans （内心： pattern",
      );
      // Short action exemption
      assert.ok(
        INNER_OS_MARKER.includes("（停顿片刻）"),
        "short action paren exemption wording present",
      );
    });

    it("does NOT contain operator meta-text (env-var / threshold / mode-switch)", () => {
      // The downgrade criterion is an operator decision rule, NOT injected
      // into the prompt. The marker must not leak config chatter.
      assert.ok(
        !INNER_OS_MARKER.includes("no_inner_os"),
        "must not contain no_inner_os mode name",
      );
      assert.ok(
        !INNER_OS_MARKER.includes("DEEPSEEK_V4_THINKING_MODE"),
        "must not contain env-var name",
      );
      assert.ok(
        !INNER_OS_MARKER.includes("20%"),
        "must not contain operator threshold",
      );
      assert.ok(
        !INNER_OS_MARKER.includes("50%"),
        "must not contain operator threshold",
      );
    });

    it("preserves original inner_os rules (role immersion)", () => {
      assert.ok(
        INNER_OS_MARKER.includes("角色沉浸要求"),
        "original marker header preserved",
      );
      assert.ok(
        INNER_OS_MARKER.includes("内心独白分析剧情"),
        "original analytical monologue rule preserved",
      );
    });
  });

  describe("appendDeepSeekThinkingMarker", () => {
    it("injects/withholds marker based on mode, model, turn, and pre-existing content", () => {
      const cases = [
        { name: "default mode", opts: { content: "你好。", mode: "default" as const, generationModel: v4ProModel, isFirstUserTurn: true }, expected: { injected: false, reason: "default_mode", content: "你好。" } },
        { name: "inner_os inject v4Pro first turn", opts: { content: "你好。", mode: "inner_os" as const, generationModel: v4ProModel, isFirstUserTurn: true }, expected: { injected: true, reason: "injected", contentMatch: /【角色沉浸要求】/u } },
        { name: "no_inner_os inject v4Pro first turn", opts: { content: "你好。", mode: "no_inner_os" as const, generationModel: v4ProModel, isFirstUserTurn: true }, expected: { injected: true, reason: "injected", contentMatch: /【思维模式要求】/u } },
        { name: "non-first turn", opts: { content: "你好。", mode: "inner_os" as const, generationModel: v4ProModel, isFirstUserTurn: false }, expected: { injected: false, reason: "not_first_user_turn", content: "你好。" } },
        { name: "anthropic model", opts: { content: "你好。", mode: "inner_os" as const, generationModel: anthropicModel, isFirstUserTurn: true }, expected: { injected: false, reason: "unsupported_model", content: "你好。" } },
        { name: "openai model", opts: { content: "你好。", mode: "inner_os" as const, generationModel: openaiModel, isFirstUserTurn: true }, expected: { injected: false, reason: "unsupported_model" } },
        { name: "deepseek-v4-flash", opts: { content: "你好。", mode: "inner_os" as const, generationModel: deepseekFlashModel, isFirstUserTurn: true }, expected: { injected: false, reason: "unsupported_model" } },
        { name: "double-inject inner_os", opts: { content: `你好。${INNER_OS_MARKER}`, mode: "inner_os" as const, generationModel: v4ProModel, isFirstUserTurn: true }, expected: { injected: false, reason: "already_present" } },
        { name: "double-inject no_inner_os", opts: { content: `你好。${NO_INNER_OS_MARKER}`, mode: "no_inner_os" as const, generationModel: v4ProModel, isFirstUserTurn: true }, expected: { injected: false, reason: "already_present" } },
      ];
      for (const c of cases) {
        const r = appendDeepSeekThinkingMarker(c.opts);
        assert.equal(r.injected, c.expected.injected, `${c.name} — injected`);
        assert.equal(r.reason, c.expected.reason, `${c.name} — reason`);
        if ("content" in c.expected) assert.equal(r.content, c.expected.content, `${c.name} — content`);
        if ("contentMatch" in c.expected) assert.match(r.content, c.expected.contentMatch!, `${c.name} — contentMatch`);
      }
    });

    it("scope behavior: every_generation and first_turn_only", () => {
      const cases = [
        { name: "every_generation injects regardless of turn", opts: { content: "你好。", mode: "inner_os" as const, generationModel: v4ProModel, isFirstUserTurn: false, scope: "every_generation" as const }, expected: { injected: true, reason: "injected", contentMatch: /【角色沉浸要求】/u } },
        { name: "first_turn_only respects turn=false", opts: { content: "你好。", mode: "inner_os" as const, generationModel: v4ProModel, isFirstUserTurn: false, scope: "first_turn_only" as const }, expected: { injected: false, reason: "not_first_user_turn", content: "你好。" } },
        { name: "every_generation respects unsupported model", opts: { content: "你好。", mode: "inner_os" as const, generationModel: anthropicModel, isFirstUserTurn: false, scope: "every_generation" as const }, expected: { injected: false, reason: "unsupported_model" } },
        { name: "every_generation respects default_mode", opts: { content: "你好。", mode: "default" as const, generationModel: v4ProModel, isFirstUserTurn: false, scope: "every_generation" as const }, expected: { injected: false, reason: "default_mode" } },
        { name: "every_generation prevents double injection", opts: { content: `你好。${INNER_OS_MARKER}`, mode: "inner_os" as const, generationModel: v4ProModel, isFirstUserTurn: false, scope: "every_generation" as const }, expected: { injected: false, reason: "already_present" } },
        { name: "omitting scope gates on isFirstUserTurn", opts: { content: "你好。", mode: "inner_os" as const, generationModel: v4ProModel, isFirstUserTurn: false }, expected: { injected: false, reason: "not_first_user_turn", content: "你好。" } },
      ];
      for (const c of cases) {
        const r = appendDeepSeekThinkingMarker(c.opts);
        assert.equal(r.injected, c.expected.injected, `${c.name} — injected`);
        assert.equal(r.reason, c.expected.reason, `${c.name} — reason`);
        if ("content" in c.expected) assert.equal(r.content, c.expected.content, `${c.name} — content`);
        if ("contentMatch" in c.expected) assert.match(r.content, c.expected.contentMatch!, `${c.name} — contentMatch`);
      }
    });
  });
});

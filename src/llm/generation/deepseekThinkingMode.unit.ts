import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendDeepSeekThinkingMarker,
  getDeepSeekThinkingMarker,
  hasDeepSeekThinkingMarker,
  isDeepSeekV4ProGenerationModel,
  INNER_OS_MARKER,
  NO_INNER_OS_MARKER,
} from "./deepseekThinkingMode";

const v4ProModel = { provider: "deepseek" as const, model: "deepseek-v4-pro" };
const anthropicModel = {
  provider: "anthropic" as const,
  model: "claude-sonnet-4-5",
};
const openaiModel = { provider: "openai" as const, model: "gpt-4o" };
const deepseekFlashModel = {
  provider: "deepseek" as const,
  model: "deepseek-v4-flash",
};

describe("deepseek thinking mode helper", () => {
  describe("isDeepSeekV4ProGenerationModel", () => {
    it("returns true for deepseek:deepseek-v4-pro", () => {
      assert.equal(isDeepSeekV4ProGenerationModel(v4ProModel), true);
    });

    it("returns false for anthropic models", () => {
      assert.equal(isDeepSeekV4ProGenerationModel(anthropicModel), false);
    });

    it("returns false for openai models", () => {
      assert.equal(isDeepSeekV4ProGenerationModel(openaiModel), false);
    });

    it("returns false for deepseek-v4-flash", () => {
      assert.equal(isDeepSeekV4ProGenerationModel(deepseekFlashModel), false);
    });
  });

  describe("getDeepSeekThinkingMarker", () => {
    it("returns inner_os marker for inner_os mode", () => {
      assert.equal(getDeepSeekThinkingMarker("inner_os"), INNER_OS_MARKER);
    });

    it("returns no_inner_os marker for no_inner_os mode", () => {
      assert.equal(
        getDeepSeekThinkingMarker("no_inner_os"),
        NO_INNER_OS_MARKER,
      );
    });

    it("returns empty string for default mode", () => {
      assert.equal(getDeepSeekThinkingMarker("default"), "");
    });
  });

  describe("hasDeepSeekThinkingMarker", () => {
    it("detects inner_os marker in content", () => {
      assert.equal(hasDeepSeekThinkingMarker(INNER_OS_MARKER), true);
    });

    it("detects no_inner_os marker in content", () => {
      assert.equal(hasDeepSeekThinkingMarker(NO_INNER_OS_MARKER), true);
    });

    it("returns false for plain content", () => {
      assert.equal(hasDeepSeekThinkingMarker("你好。"), false);
    });
  });

  describe("appendDeepSeekThinkingMarker", () => {
    it("default mode does not inject", () => {
      const result = appendDeepSeekThinkingMarker({
        content: "你好。",
        mode: "default",
        generationModel: v4ProModel,
        isFirstUserTurn: true,
      });

      assert.equal(result.injected, false);
      assert.equal(result.reason, "default_mode");
      assert.equal(result.content, "你好。");
    });

    it("injects inner_os marker for deepseek-v4-pro first turn", () => {
      const result = appendDeepSeekThinkingMarker({
        content: "你好。",
        mode: "inner_os",
        generationModel: v4ProModel,
        isFirstUserTurn: true,
      });

      assert.equal(result.injected, true);
      assert.equal(result.reason, "injected");
      assert.match(result.content, /【角色沉浸要求】/u);
    });

    it("injects no_inner_os marker for deepseek-v4-pro first turn", () => {
      const result = appendDeepSeekThinkingMarker({
        content: "你好。",
        mode: "no_inner_os",
        generationModel: v4ProModel,
        isFirstUserTurn: true,
      });

      assert.equal(result.injected, true);
      assert.equal(result.reason, "injected");
      assert.match(result.content, /【思维模式要求】/u);
    });

    it("does not inject for non-first turn", () => {
      const result = appendDeepSeekThinkingMarker({
        content: "你好。",
        mode: "inner_os",
        generationModel: v4ProModel,
        isFirstUserTurn: false,
      });

      assert.equal(result.injected, false);
      assert.equal(result.reason, "not_first_user_turn");
      assert.equal(result.content, "你好。");
    });

    it("does not inject for anthropic generation model", () => {
      const result = appendDeepSeekThinkingMarker({
        content: "你好。",
        mode: "inner_os",
        generationModel: anthropicModel,
        isFirstUserTurn: true,
      });

      assert.equal(result.injected, false);
      assert.equal(result.reason, "unsupported_model");
      assert.equal(result.content, "你好。");
    });

    it("does not inject for openai generation model", () => {
      const result = appendDeepSeekThinkingMarker({
        content: "你好。",
        mode: "inner_os",
        generationModel: openaiModel,
        isFirstUserTurn: true,
      });

      assert.equal(result.injected, false);
      assert.equal(result.reason, "unsupported_model");
    });

    it("does not inject for deepseek-v4-flash", () => {
      const result = appendDeepSeekThinkingMarker({
        content: "你好。",
        mode: "inner_os",
        generationModel: deepseekFlashModel,
        isFirstUserTurn: true,
      });

      assert.equal(result.injected, false);
      assert.equal(result.reason, "unsupported_model");
    });

    it("does not double-inject if inner_os marker already present", () => {
      const result = appendDeepSeekThinkingMarker({
        content: `你好。${INNER_OS_MARKER}`,
        mode: "inner_os",
        generationModel: v4ProModel,
        isFirstUserTurn: true,
      });

      assert.equal(result.injected, false);
      assert.equal(result.reason, "already_present");
    });

    it("does not double-inject if no_inner_os marker already present", () => {
      const result = appendDeepSeekThinkingMarker({
        content: `你好。${NO_INNER_OS_MARKER}`,
        mode: "no_inner_os",
        generationModel: v4ProModel,
        isFirstUserTurn: true,
      });

      assert.equal(result.injected, false);
      assert.equal(result.reason, "already_present");
    });

    describe("scope behavior", () => {
      it("every_generation injects regardless of isFirstUserTurn", () => {
        const result = appendDeepSeekThinkingMarker({
          content: "你好。",
          mode: "inner_os",
          generationModel: v4ProModel,
          isFirstUserTurn: false,
          scope: "every_generation",
        });

        assert.equal(result.injected, true);
        assert.equal(result.reason, "injected");
        assert.match(result.content, /【角色沉浸要求】/u);
      });

      it("first_turn_only (default) respects isFirstUserTurn=false", () => {
        const result = appendDeepSeekThinkingMarker({
          content: "你好。",
          mode: "inner_os",
          generationModel: v4ProModel,
          isFirstUserTurn: false,
          scope: "first_turn_only",
        });

        assert.equal(result.injected, false);
        assert.equal(result.reason, "not_first_user_turn");
        assert.equal(result.content, "你好。");
      });

      it("every_generation still respects unsupported model gate", () => {
        const result = appendDeepSeekThinkingMarker({
          content: "你好。",
          mode: "inner_os",
          generationModel: anthropicModel,
          isFirstUserTurn: false,
          scope: "every_generation",
        });

        assert.equal(result.injected, false);
        assert.equal(result.reason, "unsupported_model");
      });

      it("every_generation still respects default_mode gate", () => {
        const result = appendDeepSeekThinkingMarker({
          content: "你好。",
          mode: "default",
          generationModel: v4ProModel,
          isFirstUserTurn: false,
          scope: "every_generation",
        });

        assert.equal(result.injected, false);
        assert.equal(result.reason, "default_mode");
      });

      it("every_generation still prevents double injection", () => {
        const result = appendDeepSeekThinkingMarker({
          content: `你好。${INNER_OS_MARKER}`,
          mode: "inner_os",
          generationModel: v4ProModel,
          isFirstUserTurn: false,
          scope: "every_generation",
        });

        assert.equal(result.injected, false);
        assert.equal(result.reason, "already_present");
      });

      it("omitting scope defaults to first_turn_only", () => {
        const result = appendDeepSeekThinkingMarker({
          content: "你好。",
          mode: "inner_os",
          generationModel: v4ProModel,
          isFirstUserTurn: false,
        });

        assert.equal(result.injected, false);
        assert.equal(result.reason, "not_first_user_turn");
      });
    });
  });
});

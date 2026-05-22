import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { __testing } from "./generateAndValidate";

describe("decorateUserMessageForGeneration", () => {
  it("returns original content when marker is not injected", () => {
    // The helper reads env.DEEPSEEK_V4_THINKING_MODE and models.generation.
    // When the mode is default, no injection happens.
    const result = __testing.decorateUserMessageForGeneration({
      userMessage: "你好。",
      isFirstUserTurn: false,
    });
    // Even if injection would be possible, isFirstUserTurn=false gates it.
    assert.equal(result.content, "你好。");
    assert.equal(result.markerInjected, false);
    assert.equal(typeof result.markerReason, "string");
  });

  it("returns content and marker metadata as an object", () => {
    const result = __testing.decorateUserMessageForGeneration({
      userMessage: "test message",
      isFirstUserTurn: true,
    });
    assert.equal(typeof result.content, "string");
    assert.equal(typeof result.markerInjected, "boolean");
    assert.equal(typeof result.markerReason, "string");
  });
});

describe("traceInputsForGenerationToolLoop", () => {
  const systemPrompt = "[SYSTEM]\n你是左然，一个虚构角色。";

  function buildInput(messages: Array<{ role: string; content: string }>, overrides?: Record<string, unknown>) {
    // LangSmith traceable wraps function inputs as { input: actualArgs }
    return {
      input: {
        messages,
        ctx: {},
        enableTools: true,
        allowedToolNames: ["web_search"],
        ...overrides,
      },
    };
  }

  it("preserves the messages array", () => {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: "你好" },
    ];
    const output = __testing.traceInputsForGenerationToolLoop(buildInput(messages));
    assert.ok(Array.isArray(output.messages));
    assert.equal(output.messages.length, 2);
    assert.equal(output.messages[0].role, "system");
    assert.equal(output.messages[0].content, systemPrompt);
  });

  it("preserves systemPromptChars", () => {
    const messages = [{ role: "system", content: systemPrompt }];
    const output = __testing.traceInputsForGenerationToolLoop(buildInput(messages));
    assert.equal(output.systemPromptChars, systemPrompt.length);
  });

  it("preserves conversationMessageCount", () => {
    const messages = [
      { role: "system", content: "sys" },
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ];
    const output = __testing.traceInputsForGenerationToolLoop(buildInput(messages));
    assert.equal(output.conversationMessageCount, 4);
  });

  it("preserves userMessageChars and userMessagePreview", () => {
    const userContent = "这是一个测试消息，用于验证追踪输入。";
    const messages = [
      { role: "user", content: "earlier" },
      { role: "user", content: userContent },
    ];
    const output = __testing.traceInputsForGenerationToolLoop(buildInput(messages));
    assert.equal(output.userMessageChars, userContent.length);
    assert.equal(output.userMessagePreview, userContent.slice(0, 200));
  });

  it("preserves allowedToolNames and enableTools", () => {
    const messages = [{ role: "user", content: "hi" }];
    const output = __testing.traceInputsForGenerationToolLoop(
      buildInput(messages, { allowedToolNames: ["web_search"], enableTools: true }),
    );
    assert.deepEqual(output.allowedToolNames, ["web_search"]);
    assert.equal(output.enableTools, true);
  });

  it("sets enableTools false when disabled", () => {
    const messages = [{ role: "user", content: "hi" }];
    const output = __testing.traceInputsForGenerationToolLoop(
      buildInput(messages, { enableTools: false }),
    );
    assert.equal(output.enableTools, false);
  });

  it("does not include systemPromptPreview", () => {
    const messages = [{ role: "system", content: systemPrompt }];
    const output = __testing.traceInputsForGenerationToolLoop(buildInput(messages));
    assert.ok(!("systemPromptPreview" in output), "systemPromptPreview should not be present");
  });

  it("handles empty messages gracefully", () => {
    const output = __testing.traceInputsForGenerationToolLoop(buildInput([]));
    assert.equal(output.systemPromptChars, 0);
    assert.equal(output.conversationMessageCount, 0);
    assert.equal(output.userMessageChars, 0);
    assert.equal(output.userMessagePreview, "");
    assert.ok(Array.isArray(output.messages));
    assert.equal(output.messages.length, 0);
  });

  it("includes deepseek marker trace fields when present in input", () => {
    const messages = [{ role: "user", content: "hi" }];
    const output = __testing.traceInputsForGenerationToolLoop({
      input: {
        messages,
        ctx: {},
        enableTools: true,
        deepseekThinkingMode: "inner_os",
        deepseekThinkingMarkerInjected: true,
        deepseekThinkingMarkerReason: "injected",
        deepseekThinkingMarkerPlacement: "current_user_message",
        deepseekThinkingTargetModel: "deepseek:deepseek-v4-pro",
      },
    });
    assert.equal(output.deepseekThinkingMode, "inner_os");
    assert.equal(output.deepseekThinkingMarkerInjected, true);
    assert.equal(output.deepseekThinkingMarkerReason, "injected");
    assert.equal(output.deepseekThinkingMarkerPlacement, "current_user_message");
    assert.equal(output.deepseekThinkingTargetModel, "deepseek:deepseek-v4-pro");
  });

  it("omits deepseek marker trace fields when not present in input", () => {
    const messages = [{ role: "user", content: "hi" }];
    const output = __testing.traceInputsForGenerationToolLoop(buildInput(messages));
    assert.equal(output.deepseekThinkingMode, undefined);
    assert.equal(output.deepseekThinkingMarkerInjected, undefined);
    assert.equal(output.deepseekThinkingMarkerReason, undefined);
    assert.equal(output.deepseekThinkingMarkerPlacement, undefined);
    assert.equal(output.deepseekThinkingTargetModel, undefined);
  });

  it("includes rewrite placement in marker trace fields", () => {
    const messages = [{ role: "user", content: "hi" }];
    const output = __testing.traceInputsForGenerationToolLoop({
      input: {
        messages,
        ctx: {},
        enableTools: true,
        deepseekThinkingMarkerPlacement: "rewrite_current_user_message",
        deepseekThinkingMarkerInjected: true,
        deepseekThinkingMarkerReason: "injected",
      },
    });
    assert.equal(output.deepseekThinkingMarkerPlacement, "rewrite_current_user_message");
    assert.equal(output.deepseekThinkingMarkerInjected, true);
  });

  it("includes marker scope in trace fields when present", () => {
    const messages = [{ role: "user", content: "hi" }];
    const output = __testing.traceInputsForGenerationToolLoop({
      input: {
        messages,
        ctx: {},
        enableTools: true,
        deepseekThinkingMarkerScope: "every_generation",
      },
    });
    assert.equal(output.deepseekThinkingMarkerScope, "every_generation");
  });

  it("omits marker scope from trace fields when not present", () => {
    const messages = [{ role: "user", content: "hi" }];
    const output = __testing.traceInputsForGenerationToolLoop(buildInput(messages));
    assert.equal(output.deepseekThinkingMarkerScope, undefined);
  });
});

describe("message builder decoration", () => {
  const systemPrompt = "[SYSTEM]\n你是左然，一个虚构角色。";
  const userMessage = "你好。";
  const rewriteSystemPrompt = "[REWRITE]\n请修正。";

  function makePromptContext() {
    return {
      systemPrompt,
      conversationHistory: [] as Array<{ role: string; content: string }>,
    } as const;
  }

  describe("buildToolMessages", () => {
    it("returns messages array with system prompt, history, and user message", () => {
      const promptContext = makePromptContext() as Parameters<typeof __testing.buildToolMessages>[0];
      const result = __testing.buildToolMessages(promptContext, userMessage);
      assert.ok(Array.isArray(result.messages));
      assert.equal(result.messages.length, 2);
      assert.equal(result.messages[0].role, "system");
      assert.equal(result.messages[0].content, systemPrompt);
      assert.equal(result.messages[1].role, "user");
    });

    it("returns marker metadata as part of result", () => {
      const promptContext = makePromptContext() as Parameters<typeof __testing.buildToolMessages>[0];
      const result = __testing.buildToolMessages(promptContext, userMessage);
      assert.equal(typeof result.markerInjected, "boolean");
      assert.equal(typeof result.markerReason, "string");
    });

    it("includes conversation history in messages", () => {
      const promptContext = makePromptContext() as Parameters<typeof __testing.buildToolMessages>[0];
      promptContext.conversationHistory = [
        { role: "assistant", content: "你好！" },
      ];
      const result = __testing.buildToolMessages(promptContext, userMessage, {
        isFirstUserTurn: false,
      });
      assert.equal(result.messages.length, 3);
      assert.equal(result.messages[1].role, "assistant");
      assert.equal(result.messages[1].content, "你好！");
    });
  });

  describe("buildRewriteToolMessages", () => {
    it("returns messages array with rewrite system prompt, history, and user message", () => {
      const promptContext = makePromptContext() as Parameters<typeof __testing.buildToolMessages>[0];
      const result = __testing.buildRewriteToolMessages(
        promptContext,
        userMessage,
        rewriteSystemPrompt,
      );
      assert.ok(Array.isArray(result.messages));
      assert.equal(result.messages.length, 2);
      assert.equal(result.messages[0].content, rewriteSystemPrompt);
      assert.equal(result.messages[1].role, "user");
    });

    it("returns marker metadata matching draft signature", () => {
      const promptContext = makePromptContext() as Parameters<typeof __testing.buildToolMessages>[0];
      const result = __testing.buildRewriteToolMessages(
        promptContext,
        userMessage,
        rewriteSystemPrompt,
      );
      assert.equal(typeof result.markerInjected, "boolean");
      assert.equal(typeof result.markerReason, "string");
    });
  });
});

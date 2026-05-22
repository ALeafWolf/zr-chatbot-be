import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { __testing } from "./generateAndValidate";

describe("decorateUserMessageForGeneration", () => {
  it("returns content and marker metadata as an object regardless of injection", () => {
    const result = __testing.decorateUserMessageForGeneration({
      userMessage: "你好。",
      isFirstUserTurn: true,
    });
    assert.equal(typeof result.content, "string");
    assert.equal(typeof result.markerInjected, "boolean");
    assert.equal(typeof result.markerReason, "string");
  });

  it("passes isFirstUserTurn through to the helper", () => {
    const result = __testing.decorateUserMessageForGeneration({
      userMessage: "test",
      isFirstUserTurn: true,
    });
    assert.equal(typeof result.markerInjected, "boolean");
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

  it("sanitizes userMessagePreview when decorated content includes a marker", () => {
    const text = "你好。";
    const decorated = `${text}\n\n【角色沉浸要求】在你的思考过程（<think>标签内）中，请遵守以下规则：`;
    const messages = [{ role: "user", content: decorated }];
    const output = __testing.traceInputsForGenerationToolLoop(buildInput(messages));
    const preview = output.userMessagePreview as string;
    assert.ok(!preview.includes("【角色沉浸要求】"));
    assert.ok(preview.startsWith(text));
  });

  it("sanitizes marker when marker prefix begins near the 200-char preview boundary", () => {
    // Original text is 195 chars — the appended marker starts at char 197,
    // so a naive slice(0,200) would cut into the marker prefix.
    const text = "a".repeat(195);
    const decorated = `${text}\n\n【角色沉浸要求】后面的内容被截断了测试`;
    const messages = [{ role: "user", content: decorated }];
    const output = __testing.traceInputsForGenerationToolLoop(buildInput(messages));
    const preview = output.userMessagePreview as string;
    // The preview must not contain any part of the marker prefix.
    assert.ok(!preview.includes("【角色沉浸要求】"));
    // The preview should contain the full original text (sanitize before truncate).
    assert.ok(preview === text || preview.startsWith(text));
    assert.equal(preview.length, Math.min(text.length, 200));
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

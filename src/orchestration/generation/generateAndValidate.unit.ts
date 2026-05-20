import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { __testing } from "./generateAndValidate";

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
});

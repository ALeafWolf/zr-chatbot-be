import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { __testing, generateDraft, validateDraft, rewriteDraft, safeDeflection, buildValidatorContext } from "./generateAndValidate";

describe("decorateUserMessageForGeneration", () => {
  it("returns content, marker metadata, and passes isFirstUserTurn", () => {
    let result = __testing.decorateUserMessageForGeneration({ userMessage: "你好。", isFirstUserTurn: true });
    assert.equal(typeof result.content, "string", "content type");
    assert.equal(typeof result.markerInjected, "boolean", "markerInjected type");
    assert.equal(typeof result.markerReason, "string", "markerReason type");

    result = __testing.decorateUserMessageForGeneration({ userMessage: "test", isFirstUserTurn: true });
    assert.equal(typeof result.markerInjected, "boolean", "passes isFirstUserTurn");
  });
});

describe("traceInputsForGenerationToolLoop", () => {
  it("preserves/omits all trace fields", () => {
    const systemPrompt = "[SYSTEM]\n你是左然，一个虚构角色。";

    // Preserves messages array
    let messages = [{ role: "system", content: systemPrompt }, { role: "user", content: "你好" }];
    let output = __testing.traceInputsForGenerationToolLoop({ input: { messages, ctx: {}, enableTools: true, allowedToolNames: ["web_search"] } });
    assert.ok(Array.isArray(output.messages), "messages — is array");
    assert.equal(output.messages.length, 2, "messages — length");
    assert.equal(output.messages[0].role, "system", "messages — role");
    assert.equal(output.messages[0].content, systemPrompt, "messages — content");

    // systemPromptChars
    messages = [{ role: "system", content: systemPrompt }];
    output = __testing.traceInputsForGenerationToolLoop({ input: { messages, ctx: {}, enableTools: true } });
    assert.equal(output.systemPromptChars, systemPrompt.length, "systemPromptChars");

    // conversationMessageCount
    messages = [{ role: "system", content: "sys" }, { role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }];
    output = __testing.traceInputsForGenerationToolLoop({ input: { messages, ctx: {}, enableTools: true } });
    assert.equal(output.conversationMessageCount, 4, "conversationMessageCount");

    // userMessageChars and userMessagePreview
    const userContent = "这是一个测试消息，用于验证追踪输入。";
    messages = [{ role: "user", content: "earlier" }, { role: "user", content: userContent }];
    output = __testing.traceInputsForGenerationToolLoop({ input: { messages, ctx: {}, enableTools: true } });
    assert.equal(output.userMessageChars, userContent.length, "userMessageChars");
    assert.equal(output.userMessagePreview, userContent.slice(0, 200), "userMessagePreview");

    // allowedToolNames and enableTools
    messages = [{ role: "user", content: "hi" }];
    output = __testing.traceInputsForGenerationToolLoop({ input: { messages, ctx: {}, enableTools: true, allowedToolNames: ["web_search"] } });
    assert.deepEqual(output.allowedToolNames, ["web_search"], "allowedToolNames");
    assert.equal(output.enableTools, true, "enableTools true");
    output = __testing.traceInputsForGenerationToolLoop({ input: { messages, ctx: {}, enableTools: false } });
    assert.equal(output.enableTools, false, "enableTools false");

    // No systemPromptPreview
    messages = [{ role: "system", content: systemPrompt }];
    output = __testing.traceInputsForGenerationToolLoop({ input: { messages, ctx: {}, enableTools: true } });
    assert.ok(!("systemPromptPreview" in output), "no systemPromptPreview");

    // Empty messages
    output = __testing.traceInputsForGenerationToolLoop({ input: { messages: [], ctx: {}, enableTools: true } });
    assert.equal(output.systemPromptChars, 0, "empty — systemPromptChars");
    assert.equal(output.conversationMessageCount, 0, "empty — conversationMessageCount");
    assert.equal(output.userMessageChars, 0, "empty — userMessageChars");
    assert.equal(output.userMessagePreview, "", "empty — userMessagePreview");
    assert.ok(Array.isArray(output.messages), "empty — messages array");
    assert.equal(output.messages.length, 0, "empty — messages length");

    // DeepSeek marker fields present
    messages = [{ role: "user", content: "hi" }];
    output = __testing.traceInputsForGenerationToolLoop({ input: { messages, ctx: {}, enableTools: true, deepseekThinkingMode: "inner_os", deepseekThinkingMarkerInjected: true, deepseekThinkingMarkerReason: "injected", deepseekThinkingMarkerPlacement: "current_user_message", deepseekThinkingTargetModel: "deepseek:deepseek-v4-pro" } });
    assert.equal(output.deepseekThinkingMode, "inner_os", "ds — mode");
    assert.equal(output.deepseekThinkingMarkerInjected, true, "ds — injected");
    assert.equal(output.deepseekThinkingMarkerReason, "injected", "ds — reason");
    assert.equal(output.deepseekThinkingMarkerPlacement, "current_user_message", "ds — placement");
    assert.equal(output.deepseekThinkingTargetModel, "deepseek:deepseek-v4-pro", "ds — targetModel");

    // DeepSeek marker fields absent
    messages = [{ role: "user", content: "hi" }];
    output = __testing.traceInputsForGenerationToolLoop({ input: { messages, ctx: {}, enableTools: true } });
    assert.equal(output.deepseekThinkingMode, undefined, "no ds — mode");
    assert.equal(output.deepseekThinkingMarkerInjected, undefined, "no ds — injected");
    assert.equal(output.deepseekThinkingMarkerReason, undefined, "no ds — reason");
    assert.equal(output.deepseekThinkingMarkerPlacement, undefined, "no ds — placement");
    assert.equal(output.deepseekThinkingTargetModel, undefined, "no ds — targetModel");

    // Rewrite placement
    output = __testing.traceInputsForGenerationToolLoop({ input: { messages: [{ role: "user", content: "hi" }], ctx: {}, enableTools: true, deepseekThinkingMarkerPlacement: "rewrite_current_user_message", deepseekThinkingMarkerInjected: true, deepseekThinkingMarkerReason: "injected" } });
    assert.equal(output.deepseekThinkingMarkerPlacement, "rewrite_current_user_message", "rewrite — placement");
    assert.equal(output.deepseekThinkingMarkerInjected, true, "rewrite — injected");

    // Marker scope present
    output = __testing.traceInputsForGenerationToolLoop({ input: { messages: [{ role: "user", content: "hi" }], ctx: {}, enableTools: true, deepseekThinkingMarkerScope: "every_generation" } });
    assert.equal(output.deepseekThinkingMarkerScope, "every_generation", "scope — present");

    // Marker scope absent
    messages = [{ role: "user", content: "hi" }];
    output = __testing.traceInputsForGenerationToolLoop({ input: { messages, ctx: {}, enableTools: true } });
    assert.equal(output.deepseekThinkingMarkerScope, undefined, "scope — absent");

    // Sanitizes marker from userMessagePreview
    const text = "你好。";
    const decorated = `${text}\n\n【角色沉浸要求】在你的思考过程（<think>标签内）中，请遵守以下规则：`;
    messages = [{ role: "user", content: decorated }];
    output = __testing.traceInputsForGenerationToolLoop({ input: { messages, ctx: {}, enableTools: true } });
    const preview = output.userMessagePreview as string;
    assert.ok(!preview.includes("【角色沉浸要求】"), "sanitize — marker removed");
    assert.ok(preview.startsWith(text), "sanitize — text preserved");

    // Marker near preview boundary (195 chars + marker)
    const longText = "a".repeat(195);
    const decoratedLong = `${longText}\n\n【角色沉浸要求】后面的内容被截断了测试`;
    messages = [{ role: "user", content: decoratedLong }];
    output = __testing.traceInputsForGenerationToolLoop({ input: { messages, ctx: {}, enableTools: true } });
    const preview2 = output.userMessagePreview as string;
    assert.ok(!preview2.includes("【角色沉浸要求】"), "boundary — marker removed");
    assert.ok(preview2 === longText || preview2.startsWith(longText), "boundary — text preserved");
    assert.equal(preview2.length, Math.min(longText.length, 200), "boundary — length");
  });
});

describe("generateDraft", () => {
  it("is an exported async generator function with correct return shape", async () => {
    const gen = generateDraft({
      promptContext: { systemPrompt: "[SYSTEM]", conversationHistory: [] } as any,
      userMessage: "hello",
      session: { sessionId: "sess_test", characterId: "zuo_ran", thinking: true } as any,
      characterDefaults: { character_id: "zuo_ran", name: "Zuo Ran" } as any,
      toolCtx: { sessionId: "sess_test", characterId: "zuo_ran", memoryNamespace: "main", continuityScope: "main", continuityFamily: "main_world", signal: new AbortController().signal } as any,
      thoughtSummaryCache: new Map(), thoughtsAcc: [], isFirstUserTurn: false,
      voiceHints: "formal, restrained", openAICompatibleRequestExtensions: undefined,
      buildMessages: () => ({ messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }], markerInjected: false, markerReason: "" }),
    });
    assert.ok(gen, "generateDraft should return an async generator");
    assert.equal(typeof gen[Symbol.asyncIterator], "function");
  });
});

describe("validateDraft", () => {
  it("is an exported async function with 3 parameters", () => {
    assert.equal(typeof validateDraft, "function");
    assert.equal(validateDraft.length, 3);
  });
});

describe("rewriteDraft", () => {
  it("is an exported async generator function", () => {
    const gen = rewriteDraft({
      promptContext: { systemPrompt: "[SYSTEM]", conversationHistory: [] } as any,
      userMessage: "hello",
      session: { sessionId: "sess_test", characterId: "zuo_ran", thinking: true } as any,
      characterDefaults: { character_id: "zuo_ran", name: "Zuo Ran" } as any,
      toolCtx: { signal: new AbortController().signal } as any,
      thoughtSummaryCache: new Map(), thoughtsAcc: [], isFirstUserTurn: false,
      voiceHints: "formal, restrained", openAICompatibleRequestExtensions: undefined,
      issues: ["issue 1"], rewriteIntro: "rewriting...",
      buildRewriteMessages: () => ({ messages: [{ role: "system", content: "rewrite" }, { role: "user", content: "fix" }], markerInjected: false, markerReason: "" }),
    });
    assert.ok(gen);
    assert.equal(typeof gen[Symbol.asyncIterator], "function");
  });
});

describe("safeDeflection", () => {
  it("is an exported async generator function", () => {
    const gen = safeDeflection({ characterName: "Zuo Ran", safeDeflectionText: "I am not sure.", reason: "tool_loop_exceeded", thoughtSummaryCache: new Map(), thoughtsAcc: [], voiceHints: "formal, restrained" });
    assert.ok(gen);
    assert.equal(typeof gen[Symbol.asyncIterator], "function");
  });
});

describe("message builder decoration", () => {
  const systemPrompt = "[SYSTEM]\n你是左然，一个虚构角色。";
  const userMessage = "你好。";
  const rewriteSystemPrompt = "[REWRITE]\n请修正。";

  it("buildToolMessages and buildRewriteToolMessages produce correct message arrays and metadata", () => {
    // buildToolMessages: basic
    let result = __testing.buildToolMessages({ systemPrompt, conversationHistory: [] } as Parameters<typeof __testing.buildToolMessages>[0], userMessage);
    assert.ok(Array.isArray(result.messages), "tool — is array");
    assert.equal(result.messages.length, 2, "tool — length");
    assert.equal(result.messages[0].role, "system", "tool — role");
    assert.equal(result.messages[0].content, systemPrompt, "tool — content");
    assert.equal(result.messages[1].role, "user", "tool — user role");
    assert.equal(typeof result.markerInjected, "boolean", "tool — markerInjected");
    assert.equal(typeof result.markerReason, "string", "tool — markerReason");

    // buildToolMessages: with history
    result = __testing.buildToolMessages({ systemPrompt, conversationHistory: [{ role: "assistant", content: "你好！" }] } as Parameters<typeof __testing.buildToolMessages>[0], userMessage, { isFirstUserTurn: false });
    assert.equal(result.messages.length, 3, "tool history — length");
    assert.equal(result.messages[1].role, "assistant", "tool history — role");
    assert.equal(result.messages[1].content, "你好！", "tool history — content");

    // buildRewriteToolMessages: basic
    let rewriteResult = __testing.buildRewriteToolMessages({ systemPrompt, conversationHistory: [] } as Parameters<typeof __testing.buildToolMessages>[0], userMessage, rewriteSystemPrompt);
    assert.ok(Array.isArray(rewriteResult.messages), "rewrite — is array");
    assert.equal(rewriteResult.messages.length, 2, "rewrite — length");
    assert.equal(rewriteResult.messages[0].content, rewriteSystemPrompt, "rewrite — system");
    assert.equal(rewriteResult.messages[1].role, "user", "rewrite — user");
    assert.equal(typeof rewriteResult.markerInjected, "boolean", "rewrite — markerInjected");
    assert.equal(typeof rewriteResult.markerReason, "string", "rewrite — markerReason");
  });
});

describe("buildValidatorContext canonTruthMode propagation", () => {
  it("passes canonTruthMode from promptContext and defaults to undefined when not set", () => {
    let ctx = buildValidatorContext({
      session: { characterId: "zuo_ran", continuityScope: "main", mode: "canonical_live" },
      personaOverlay: { max_nsfw_level: "medium", escalation_rule: "none", out_of_scope_chapter_behavior: "deflect" },
      promptContext: { conversationHistory: [], retrievedCanonNarrative: "Some canon narrative about Fenghe.", selectedMemorySources: [], canonTruthMode: "strict_canon_recall" },
      userMessage: "你还记得那封信吗？",
    });
    assert.equal(ctx.canonTruthMode, "strict_canon_recall", "propagated");

    ctx = buildValidatorContext({
      session: { characterId: "zuo_ran", continuityScope: "main", mode: "canonical_live" },
      personaOverlay: { max_nsfw_level: "medium", escalation_rule: "none", out_of_scope_chapter_behavior: "deflect" },
      promptContext: { conversationHistory: [] },
      userMessage: "你好",
    });
    assert.equal(ctx.canonTruthMode, undefined, "default undefined");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createOpenAIProvider, __test_setClient } from "./openaiProvider";

function mkCompletion(o: { prompt_tokens: number; completion_tokens: number; cached_tokens?: number; reasoning_tokens?: number }) {
  return { id: "c1", object: "chat.completion", created: 1_000_000, model: "gpt-5-nano", choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }], usage: { prompt_tokens: o.prompt_tokens, completion_tokens: o.completion_tokens, total_tokens: o.prompt_tokens + o.completion_tokens, prompt_tokens_details: o.cached_tokens !== undefined ? { cached_tokens: o.cached_tokens } : undefined, completion_tokens_details: o.reasoning_tokens !== undefined ? { reasoning_tokens: o.reasoning_tokens } : undefined } };
}

describe("OpenAI provider — non-streaming cached input and reasoning tokens", () => {
  it("emits/omits cached/reasoning tokens, passes through malformed, handles null usage", async () => {
    const run = async (completion: any) => { __test_setClient({ chat: { completions: { create: async () => completion } } } as never); return (await createOpenAIProvider("gpt-5-nano").chat([{ role: "user", content: "Hi" }])); };
    let r = await run(mkCompletion({ prompt_tokens: 100, completion_tokens: 50, cached_tokens: 30, reasoning_tokens: 10 }));
    assert.equal(r.inputTokens, 100, "input passthrough"); assert.equal(r.outputTokens, 50, "output passthrough");
    assert.equal(r.usage!.cachedInputTokens, 30, "cached present"); assert.equal(r.usage!.reasoningTokens, 10, "reasoning present");
    r = await run(mkCompletion({ prompt_tokens: 200, completion_tokens: 80 }));
    assert.equal(r.usage!.cachedInputTokens, undefined, "cached omitted"); assert.equal(r.usage!.reasoningTokens, undefined, "reasoning omitted");
    r = await run(mkCompletion({ prompt_tokens: 50, completion_tokens: 20, cached_tokens: 999 }));
    assert.equal(r.usage!.cachedInputTokens, 999, "malformed passes through");
    r = await run({ id: "c2", object: "chat.completion", created: 1_000_000, model: "gpt-5-nano", choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }], usage: null });
    assert.equal(r.inputTokens, 0, "null usage → 0 input"); assert.equal(r.outputTokens, 0, "null usage → 0 output"); assert.equal(r.usage, undefined, "null usage → undefined");
  });
});

describe("OpenAI provider — max_completion_tokens, reasoning_effort, temperature by model", () => {
  it("tests params by model: max_completion_tokens for reasoning, max_tokens for others; reasoning_effort; temperature omission", async () => {
    let p: any; const cap = async (model: string, opts?: any) => { __test_setClient({ chat: { completions: { create: async (params: any) => { p = params; return mkCompletion({ prompt_tokens: 10, completion_tokens: 5 }); } } } } as never); await createOpenAIProvider(model).chat([{ role: "user", content: "Hi" }], opts); };
    await cap("gpt-5-mini"); assert.equal(p!.max_completion_tokens, 2048, "gpt-5-mini → max_completion_tokens"); assert.equal(p!.max_tokens, undefined, "gpt-5-mini → no max_tokens");
    await cap("gpt-4o-mini"); assert.equal(p!.max_tokens, 2048, "gpt-4o-mini → max_tokens"); assert.equal(p!.max_completion_tokens, undefined, "gpt-4o-mini → no max_completion_tokens");
    await cap("gpt-5-mini"); assert.equal(p!.reasoning_effort, "low", "gpt-5-mini → reasoning_effort");
    await cap("gpt-5-mini", { openAICompatibleRequestExtensions: { reasoning_effort: "high" } }); assert.equal(p!.reasoning_effort, "high", "caller override");
    await cap("gpt-4o-mini"); assert.equal(p!.reasoning_effort, undefined, "gpt-4o-mini → no reasoning_effort");
    await cap("gpt-5-mini"); assert.equal("temperature" in p!, false, "gpt-5-mini → temperature omitted");
    await cap("gpt-5-mini"); assert.equal("temperature" in p!, false, "gpt-5-mini with reasoning — still omitted");
    await cap("gpt-4o-mini"); assert.equal(p!.temperature, 1.0, "gpt-4o-mini → temperature included");
  });
});

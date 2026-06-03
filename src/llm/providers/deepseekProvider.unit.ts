import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDeepSeekProvider, __test_setClient } from "./deepseekProvider";
import type { LLMUsage } from "./providerTypes";

function mkCompletion(o: { prompt_tokens: number; completion_tokens: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number; reasoning_tokens?: number }) {
  return { id: "c1", object: "chat.completion", created: 1_000_000, model: "deepseek-v4-flash", choices: [{ index: 0, message: { role: "assistant", content: "Hello", ...(o.reasoning_tokens !== undefined ? { reasoning_content: "thinking..." } : {}) }, finish_reason: "stop" }], usage: { prompt_tokens: o.prompt_tokens, completion_tokens: o.completion_tokens, total_tokens: o.prompt_tokens + o.completion_tokens, prompt_cache_hit_tokens: o.prompt_cache_hit_tokens ?? null, prompt_cache_miss_tokens: o.prompt_cache_miss_tokens ?? null, completion_tokens_details: o.reasoning_tokens !== undefined ? { reasoning_tokens: o.reasoning_tokens } : undefined } };
}

describe("DeepSeek provider — non-streaming cache hit/miss and reasoning tokens", () => {
  it("handles cache-hit-only, cache-miss-only, mixed, with reasoning, malformed combo, and absent", async () => {
    const run = async (completion: any) => { __test_setClient({ chat: { completions: { create: async () => completion } } } as never); return (await createDeepSeekProvider("deepseek-v4-flash").chat([{ role: "user", content: "Hi" }])); };
    let r = await run(mkCompletion({ prompt_tokens: 200, completion_tokens: 80, prompt_cache_hit_tokens: 200, prompt_cache_miss_tokens: 0 }));
    assert.equal(r.usage!.cacheHitInputTokens, 200, "hit only"); assert.equal(r.usage!.cacheMissInputTokens, 0, "hit only — miss 0");
    r = await run(mkCompletion({ prompt_tokens: 150, completion_tokens: 60, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 150 }));
    assert.equal(r.usage!.cacheHitInputTokens, 0, "miss only — hit 0"); assert.equal(r.usage!.cacheMissInputTokens, 150, "miss only");
    r = await run(mkCompletion({ prompt_tokens: 500, completion_tokens: 200, prompt_cache_hit_tokens: 150, prompt_cache_miss_tokens: 350 }));
    assert.equal(r.usage!.cacheHitInputTokens, 150, "mixed hit"); assert.equal(r.usage!.cacheMissInputTokens, 350, "mixed miss");
    r = await run(mkCompletion({ prompt_tokens: 300, completion_tokens: 120, prompt_cache_hit_tokens: 100, prompt_cache_miss_tokens: 200, reasoning_tokens: 30 }));
    assert.equal(r.usage!.cacheHitInputTokens, 100); assert.equal(r.usage!.cacheMissInputTokens, 200); assert.equal(r.usage!.reasoningTokens, 30, "reasoning"); assert.equal(r.reasoningContent, "thinking...", "reasoningContent");
    r = await run(mkCompletion({ prompt_tokens: 100, completion_tokens: 40, prompt_cache_hit_tokens: 999, prompt_cache_miss_tokens: 1 }));
    assert.equal(r.usage!.cacheHitInputTokens, 999, "malformed passes through"); assert.equal(r.usage!.cacheMissInputTokens, 1, "malformed miss");
    r = await run(mkCompletion({ prompt_tokens: 50, completion_tokens: 20 }));
    assert.equal(r.usage!.cacheHitInputTokens, undefined, "absent — hit undefined"); assert.equal(r.usage!.cacheMissInputTokens, undefined, "absent — miss undefined");
  });
});

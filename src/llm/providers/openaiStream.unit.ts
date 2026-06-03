import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import { streamOpenAICompatibleChat } from "./openaiStream";

function mockChunk(o: { prompt_tokens?: number; completion_tokens?: number; cached_tokens?: number; reasoning_tokens?: number; content?: string; finish_reason?: string | null; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number }) {
  const usage = o.prompt_tokens !== undefined ? { prompt_tokens: o.prompt_tokens, completion_tokens: o.completion_tokens ?? 0, total_tokens: (o.prompt_tokens ?? 0) + (o.completion_tokens ?? 0), prompt_tokens_details: o.cached_tokens !== undefined ? { cached_tokens: o.cached_tokens } : undefined, completion_tokens_details: o.reasoning_tokens !== undefined ? { reasoning_tokens: o.reasoning_tokens } : undefined, prompt_cache_hit_tokens: o.prompt_cache_hit_tokens ?? null, prompt_cache_miss_tokens: o.prompt_cache_miss_tokens ?? null } : undefined;
  return { id: "c1", object: "chat.completion.chunk", created: 1_000_000, model: "gpt-5-nano", choices: [{ index: 0, delta: { content: o.content ?? null }, finish_reason: o.finish_reason ?? null }], usage: usage ?? null };
}
async function* toStream<T>(chunks: T[]): AsyncIterable<T> { for (const c of chunks) yield c; }
async function drain(client: OpenAI, model = "gpt-5-nano", opts?: Record<string, unknown>): Promise<any[]> {
  const evs: any[] = []; for await (const e of streamOpenAICompatibleChat(client, model, [{ role: "user", content: "Hi" }], opts)) evs.push(e); return evs;
}
function makeClient(chunks: any[]): OpenAI { return { chat: { completions: { create: async () => toStream(chunks) } } } as any; }

describe("OpenAI stream — cached input token accumulation", () => {
  it("accumulates cachedInputTokens/reasoningTokens, omits when no caching, passes through malformed", async () => {
    const cases: Array<{ chunks: any[]; checks: (evs: any[]) => void }> = [
      { chunks: [mockChunk({ content: "H", finish_reason: null }), mockChunk({ content: "", finish_reason: "stop", prompt_tokens: 100, completion_tokens: 50, cached_tokens: 30 })], checks: (e) => { assert.equal(e.length, 2, "delta + done"); assert.equal(e[0].type, "delta", "first delta"); assert.equal(e[1].type, "assistant_done", "final done"); assert.equal(e[1].usage.inputTokens, 100, "input passthrough"); assert.equal(e[1].usage.outputTokens, 50, "output passthrough"); assert.equal(e[1].usage.cachedInputTokens, 30, "cached"); } },
      { chunks: [mockChunk({ content: "H", finish_reason: null }), mockChunk({ content: "", finish_reason: "stop", prompt_tokens: 200, completion_tokens: 80, cached_tokens: 50, reasoning_tokens: 20 })], checks: (e) => { assert.equal(e[1].usage.inputTokens, 200, "input"); assert.equal(e[1].usage.outputTokens, 80, "output"); assert.equal(e[1].usage.cachedInputTokens, 50, "cached+reason"); assert.equal(e[1].usage.reasoningTokens, 20, "reason"); } },
      { chunks: [mockChunk({ content: "H", finish_reason: null }), mockChunk({ content: "", finish_reason: "stop", prompt_tokens: 50, completion_tokens: 25 })], checks: (e) => { assert.equal(e[1].usage.cachedInputTokens, undefined, "no cache"); } },
      { chunks: [mockChunk({ content: "H", finish_reason: null }), mockChunk({ content: "", finish_reason: "stop", prompt_tokens: 50, completion_tokens: 10, cached_tokens: 999 })], checks: (e) => { assert.equal(e[1].usage.cachedInputTokens, 999, "malformed"); } },
    ];
    for (const c of cases) { const evs = await drain(makeClient(c.chunks)); c.checks(evs); }
  });
});

describe("DeepSeek stream — flat cache hit/miss accumulation", () => {
  it("accumulates cacheHit/MissInputTokens and reasoningTokens, omits when no caching", async () => {
    const cases: Array<{ chunks: any[]; checks: (evs: any[]) => void }> = [
      { chunks: [mockChunk({ content: "H", finish_reason: null }), mockChunk({ content: "", finish_reason: "stop", prompt_tokens: 200, completion_tokens: 80, prompt_cache_hit_tokens: 150, prompt_cache_miss_tokens: 50 })], checks: (e) => { assert.equal(e.length, 2, "delta + done"); assert.equal(e[1].usage.cacheHitInputTokens, 150, "hit"); assert.equal(e[1].usage.cacheMissInputTokens, 50, "miss"); } },
      { chunks: [mockChunk({ content: "H", finish_reason: null }), mockChunk({ content: "", finish_reason: "stop", prompt_tokens: 300, completion_tokens: 120, prompt_cache_hit_tokens: 100, prompt_cache_miss_tokens: 200, reasoning_tokens: 30 })], checks: (e) => { assert.equal(e[1].usage.cacheHitInputTokens, 100, "hit"); assert.equal(e[1].usage.cacheMissInputTokens, 200, "miss"); assert.equal(e[1].usage.reasoningTokens, 30, "reason"); } },
      { chunks: [mockChunk({ content: "H", finish_reason: null }), mockChunk({ content: "", finish_reason: "stop", prompt_tokens: 50, completion_tokens: 25 })], checks: (e) => { assert.equal(e[1].usage.cacheHitInputTokens, undefined, "no hit"); assert.equal(e[1].usage.cacheMissInputTokens, undefined, "no miss"); } },
    ];
    for (const c of cases) { const evs = await drain(makeClient(c.chunks)); c.checks(evs); }
  });
});

describe("OpenAI stream — max_completion_tokens / max_tokens", () => {
  it("sends max_completion_tokens for reasoning models, max_tokens for non-reasoning and DeepSeek", async () => {
    let p: any; const capture = async (model: string) => { const client = { chat: { completions: { create: async (params: any) => { p = params; return toStream([mockChunk({ content: "Hi", finish_reason: "stop", prompt_tokens: 10, completion_tokens: 5 })]); } } } } as any; await drain(client, model); };
    await capture("gpt-5-mini"); assert.equal(p.max_completion_tokens, 2048, "gpt-5-mini → max_completion_tokens"); assert.equal(p.max_tokens, undefined, "gpt-5-mini → no max_tokens");
    await capture("gpt-4o-mini"); assert.equal(p.max_tokens, 2048, "gpt-4o-mini → max_tokens"); assert.equal(p.max_completion_tokens, undefined, "gpt-4o-mini → no max_completion_tokens");
    await capture("deepseek-v4-pro"); assert.equal(p.max_tokens, 2048, "deepseek → max_tokens"); assert.equal(p.max_completion_tokens, undefined, "deepseek → no max_completion_tokens");
  });
});

describe("OpenAI stream — reasoning_effort", () => {
  it("adds reasoning_effort for reasoning models, respects caller override, omits for non-reasoning and DeepSeek", async () => {
    let p: any; const capture = async (model: string, opts?: any) => { const client = { chat: { completions: { create: async (params: any) => { p = params; return toStream([mockChunk({ content: "Hi", finish_reason: "stop", prompt_tokens: 10, completion_tokens: 5 })]); } } } } as any; await drain(client, model, opts); };
    await capture("gpt-5-mini"); assert.equal(p.reasoning_effort, "low", "default");
    await capture("gpt-5-mini", { openAICompatibleRequestExtensions: { reasoning_effort: "medium" } } as any); assert.equal(p.reasoning_effort, "medium", "override");
    await capture("gpt-4o-mini"); assert.equal(p.reasoning_effort, undefined, "gpt-4o-mini");
    await capture("deepseek-v4-pro"); assert.equal(p.reasoning_effort, undefined, "deepseek");
  });
});

describe("OpenAI stream — temperature omission for reasoning models", () => {
  it("omits temperature for reasoning models, includes for non-reasoning and DeepSeek", async () => {
    let p: any; const capture = async (model: string) => { const client = { chat: { completions: { create: async (params: any) => { p = params; return toStream([mockChunk({ content: "Hi", finish_reason: "stop", prompt_tokens: 10, completion_tokens: 5 })]); } } } } as any; await drain(client, model); };
    await capture("gpt-5-mini"); assert.equal("temperature" in p, false, "gpt-5-mini");
    await capture("gpt-4o-mini"); assert.equal(p.temperature, 1.0, "gpt-4o-mini");
    await capture("deepseek-v4-pro"); assert.equal(p.temperature, 1.0, "deepseek");
  });
});

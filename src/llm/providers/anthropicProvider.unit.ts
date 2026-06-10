import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAnthropicProvider, __test_setClient } from "./anthropicProvider";
import type { LLMUsage } from "./providerTypes";

type MockUsage = { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number | null; cache_read_input_tokens: number | null; cache_creation?: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number } | null };
type MockResponse = { content: Array<{ type: string; text: string }>; stop_reason: string; usage: MockUsage };
let _mockResponse: MockResponse;

function createMockStream() {
  const it: AsyncIterable<unknown> = { [Symbol.asyncIterator]() { return { async next() { return { done: true, value: undefined } as any; } }; } };
  return Object.assign(it, { async finalMessage() { return _mockResponse; } });
}
function mkUsage(o: Partial<MockUsage> & { input_tokens: number; output_tokens: number }): MockUsage {
  return { cache_creation_input_tokens: null, cache_read_input_tokens: null, cache_creation: null, ...o };
}
function assertUsage(a: LLMUsage | undefined, e: Partial<LLMUsage> & { inputTokens: number; outputTokens: number }) {
  assert.ok(a, "usage defined"); assert.equal(a!.inputTokens, e.inputTokens); assert.equal(a!.outputTokens, e.outputTokens);
  if (e.cacheReadInputTokens !== undefined) assert.equal(a!.cacheReadInputTokens, e.cacheReadInputTokens);
  if (e.cacheCreationInputTokens !== undefined) assert.equal(a!.cacheCreationInputTokens, e.cacheCreationInputTokens);
  if (e.cacheCreation5mTokens !== undefined) assert.equal(a!.cacheCreation5mTokens, e.cacheCreation5mTokens);
  if (e.cacheCreation1hTokens !== undefined) assert.equal(a!.cacheCreation1hTokens, e.cacheCreation1hTokens);
}

describe("Anthropic provider — non-streaming cache dimensions", () => {
  it("handles 5m-only, 1h-only, mixed, read-only scenarios", async () => {
    const run = async (usage: MockUsage) => { __test_setClient({ messages: { create: async () => ({ content: [{ type: "text", text: "Hello" }], stop_reason: "end_turn", usage }), stream: () => { throw new Error("n/a"); } } } as never); return (await createAnthropicProvider("claude-sonnet-4-5").chat([{ role: "user", content: "Hi" }])).usage; };
    let u = await run(mkUsage({ input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 80, cache_read_input_tokens: null, cache_creation: { ephemeral_5m_input_tokens: 80, ephemeral_1h_input_tokens: 0 } }));
    assertUsage(u, { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: undefined, cacheCreationInputTokens: 80, cacheCreation5mTokens: 80, cacheCreation1hTokens: 0 });
    u = await run(mkUsage({ input_tokens: 200, output_tokens: 100, cache_creation_input_tokens: 150, cache_read_input_tokens: null, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 150 } }));
    assertUsage(u, { inputTokens: 200, outputTokens: 100, cacheReadInputTokens: undefined, cacheCreationInputTokens: 150, cacheCreation5mTokens: 0, cacheCreation1hTokens: 150 });
    u = await run(mkUsage({ input_tokens: 500, output_tokens: 200, cache_creation_input_tokens: 400, cache_read_input_tokens: 30, cache_creation: { ephemeral_5m_input_tokens: 300, ephemeral_1h_input_tokens: 100 } }));
    assertUsage(u, { inputTokens: 500, outputTokens: 200, cacheReadInputTokens: 30, cacheCreationInputTokens: 400, cacheCreation5mTokens: 300, cacheCreation1hTokens: 100 });
    u = await run(mkUsage({ input_tokens: 300, output_tokens: 150, cache_creation_input_tokens: null, cache_read_input_tokens: 200, cache_creation: null }));
    assertUsage(u, { inputTokens: 300, outputTokens: 150, cacheReadInputTokens: 200, cacheCreationInputTokens: undefined });
  });
});

describe("Anthropic provider — streaming cache dimensions", () => {
  it("emits cache_creation sum (no TTL split), omits when no caching", async () => {
    const run = async (usage: MockUsage) => { __test_setClient({ messages: { create: () => { throw new Error("n/a"); }, stream: () => { _mockResponse = { content: [{ type: "text", text: "Hello" }], stop_reason: "end_turn", usage }; return createMockStream(); } } } as never); const evs: any[] = []; for await (const ev of createAnthropicProvider("claude-sonnet-4-5").streamChat([{ role: "user", content: "Hi" }])) evs.push(ev); return evs; };
    let evs = await run(mkUsage({ input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 80, cache_read_input_tokens: 20, cache_creation: null }));
    assert.equal(evs.length, 1, "streaming sum — one event"); assert.equal(evs[0].type, "assistant_done", "streaming sum — done event");
    assertUsage(evs[0].usage, { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 20, cacheCreationInputTokens: 80 });
    evs = await run(mkUsage({ input_tokens: 50, output_tokens: 25, cache_creation_input_tokens: null, cache_read_input_tokens: null }));
    assert.equal(evs.length, 1, "omits — one event"); assert.equal(evs[0].type, "assistant_done", "omits — done event");
    assert.equal(evs[0].usage.cacheReadInputTokens, undefined, "no caching → read undefined");
    assert.equal(evs[0].usage.cacheCreationInputTokens, undefined, "no caching → creation undefined");
  });
});

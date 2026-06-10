import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import { z } from "zod";
import { isFallbackableLlmError, parseJsonStreamResult, buildChatJsonOptions } from "./index";

const TestSchema = z.object({ selected: z.array(z.object({ id: z.string() })), rejected: z.array(z.object({ id: z.string() })), finalContextMode: z.string(), needsEvidenceFallback: z.boolean() });
const ScenarioSchema = z.object({ ok: z.boolean() });

function mockProvider(behavior: { throwError?: unknown; content?: string }) {
  const content = behavior.content ?? JSON.stringify({ ok: true });
  return { chat: async () => { if (behavior.throwError) throw behavior.throwError; return { content, inputTokens: 100, outputTokens: 50, finishReason: "stop" as const }; }, streamChat: async function* () { if (behavior.throwError) throw behavior.throwError; yield { type: "assistant_done" as const, content, usage: { inputTokens: 100, outputTokens: 50 }, finishReason: "stop" as const }; } };
}

const primary = { provider: "openai" as const, model: "gpt-5-nano" as const };
const fallback = { provider: "openai" as const, model: "gpt-5-mini" as const };
const msgs = [{ role: "user" as const, content: "test" }];

describe("parseJsonStreamResult finishReason preservation", () => {
  it("preserves finishReason on parse/schema failure, undefined when not emitted, absent on success", () => {
    let r = parseJsonStreamResult("No JSON delimiters.", 100, 20, "stop", TestSchema);
    assert.equal(r.ok, false); if (!r.ok) { assert.equal(r.finishReason, "stop", "preserved on parse failure"); assert.equal(r.inputTokens, 100); assert.equal(r.outputTokens, 20); }
    r = parseJsonStreamResult('{"selected": "not_an_array"}', 200, 30, "length", TestSchema);
    assert.equal(r.ok, false); if (!r.ok) { assert.equal(r.finishReason, "length", "preserved on schema failure"); }
    r = parseJsonStreamResult("non-json", 50, 5, undefined, TestSchema);
    assert.equal(r.ok, false); if (!r.ok) { assert.equal(r.finishReason, undefined, "undefined when not emitted"); }
    r = parseJsonStreamResult(JSON.stringify({ selected: [{ id: "m1" }], rejected: [], finalContextMode: "recent_only", needsEvidenceFallback: false }), 300, 40, "stop", TestSchema);
    assert.equal(r.ok, true); if (r.ok) { assert.equal("finishReason" in r, false, "absent on success"); }
  });
});

describe("buildChatJsonOptions", () => {
  it("forwards extensions, omits when undefined, preserves jsonMode and signal", () => {
    let r = buildChatJsonOptions({ maxTokens: 4096, temperature: 0.3, openAICompatibleRequestExtensions: { thinking: { type: "disabled" } } });
    assert.deepEqual(r.openAICompatibleRequestExtensions, { thinking: { type: "disabled" } }, "extensions forwarded");
    r = buildChatJsonOptions({ maxTokens: 4096 }); assert.equal(r.openAICompatibleRequestExtensions, undefined, "extensions omitted");
    r = buildChatJsonOptions({}); assert.equal(r.jsonMode, true, "jsonMode true");
    const c = new AbortController(); r = buildChatJsonOptions({ signal: c.signal }); assert.equal(r.signal, c.signal, "signal preserved");
  });
});

describe("isFallbackableLlmError", () => {
  it("matches rate limits/server errors/network errors, not client/auth/aborted", () => {
    assert.equal(isFallbackableLlmError({ status: 429 }), true, "429"); assert.equal(isFallbackableLlmError({ status: 503 }), true, "503");
    assert.equal(isFallbackableLlmError(Object.assign(new Error("fetch"), { code: "ECONNRESET" })), true, "ECONNRESET");
    assert.equal(isFallbackableLlmError({ status: 401 }), false, "401");
    const c = new AbortController(); c.abort(); assert.equal(isFallbackableLlmError(new Error("aborted"), c.signal), false, "aborted");
  });
});

async function runFallbackSuite(fnName: "chatJsonWithFallback" | "chatJsonStreamWithFallback") {
  const mod = await import("./index");
  const fn = fnName === "chatJsonWithFallback" ? mod.chatJsonWithFallback : mod.chatJsonStreamWithFallback;

  // Success cases: primary error → fallback succeeds
  const successCases = [
    { name: "parse failure", primary: { content: "not-json" } as any, trigger: "parse_failure" },
    { name: "429", primary: { throwError: Object.assign(new Error("Rate limit"), { status: 429 }) }, trigger: "rate_limit" },
    { name: "503", primary: { throwError: Object.assign(new Error("Overloaded"), { status: 503 }) }, trigger: "server_error" },
    { name: "network", primary: { throwError: Object.assign(new Error("fetch failed"), { code: "ECONNRESET" }) }, trigger: "network_error" },
  ];
  for (const c of successCases) {
    let i = 0;
    mod.__testables__.setMockProvider(() => (++i === 1 ? mockProvider(c.primary) : mockProvider({})));
    const r = await fn(primary, fallback, msgs, ScenarioSchema);
    assert.equal(r.ok, true, `${c.name} — ok`);
    if (r.ok) assert.equal(r.data.ok, true, `${c.name} — data`);
    assert.equal(r.fallbackUsed, true, `${c.name} — fallbackUsed`);
    assert.equal(r.binding.model, "gpt-5-mini", `${c.name} — binding`);
    assert.equal(r.fallbackAttempts.length, 1, `${c.name} — attempts`);
    assert.equal(r.fallbackAttempts[0]!.trigger, c.trigger, `${c.name} — trigger`);
    if (c.trigger === "parse_failure") {
      assert.equal(r.fallbackAttempts[0]!.inputTokens, 100, `${c.name} — inputTokens`);
      assert.equal(r.fallbackAttempts[0]!.outputTokens, 50, `${c.name} — outputTokens`);
    }
    mod.__testables__.setMockProvider(undefined);
  }

  // Rethrow cases: 401, aborted
  const abortC = new AbortController(); abortC.abort();
  const rejectCases: Array<{ name: string; primary: any; opts: any; match: RegExp | null }> = [
    { name: "401", primary: { throwError: Object.assign(new Error("Unauthorized"), { status: 401 }) }, opts: undefined, match: /Unauthorized/i },
    { name: "aborted", primary: { throwError: Object.assign(new Error("server error"), { status: 500 }) }, opts: { signal: abortC.signal }, match: null },
  ];
  for (const c of rejectCases) {
    mod.__testables__.setMockProvider(() => mockProvider(c.primary));
    if (c.match) {
      await assert.rejects(() => fn(primary, fallback, msgs, TestSchema, c.opts), c.match, `${c.name} — rejects`);
    } else {
      await assert.rejects(() => fn(primary, fallback, msgs, TestSchema, c.opts), `${c.name} — rejects`);
    }
    mod.__testables__.setMockProvider(undefined);
  }

  // Duplicate binding: silently skipped
  let callCount = 0;
  mod.__testables__.setMockProvider(() => { callCount++; return mockProvider({}); });
  const r = await fn(primary, primary, msgs, ScenarioSchema);
  assert.equal(r.ok, true, "duplicate — ok");
  assert.equal(r.fallbackUsed, false, "duplicate — no fallback");
  assert.equal(r.fallbackAttempts.length, 0, "duplicate — no attempts");
  assert.equal(callCount, 1, "duplicate — callCount 1");
  mod.__testables__.setMockProvider(undefined);
}

describe("chatJsonWithFallback", () => {
  afterEach(async () => { (await import("./index")).__testables__.setMockProvider(undefined); });
  it("primary error → fallback success, non-fallbackable rethrow, duplicate binding", async () => { await runFallbackSuite("chatJsonWithFallback"); });
});

describe("chatJsonStreamWithFallback", () => {
  afterEach(async () => { (await import("./index")).__testables__.setMockProvider(undefined); });
  it("primary error → fallback success, non-fallbackable rethrow, duplicate binding", async () => { await runFallbackSuite("chatJsonStreamWithFallback"); });
});

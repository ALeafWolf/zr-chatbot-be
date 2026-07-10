import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runRoleplayGenerationAdapter, type RoleplayGenerationInput } from "./roleplayGenerationAdapter";
import type { Thought } from "../thought/thoughtTypes";
import type { PromptContext } from "../prompt/buildPromptContext";
import type { GenerateAndValidateResult } from "../generation/generateAndValidate";

function fakeInput(overrides?: Partial<RoleplayGenerationInput>): RoleplayGenerationInput { return { promptContext: { systemPrompt: "[SYSTEM]\nTest.", conversationHistory: [] }, userMessage: "hello", session: { sessionId: "s-001", characterId: "zuo_ran", playerId: "p-001", mode: "canonical_live", continuityScope: "main", continuityFamily: "main_world", personaOverlayId: null, memoryNamespace: "main", pinnedTime: null, pinnedLocation: null, writebackPolicy: "full_writeback", sessionSummary: null, displayTitle: null, thinking: true, temperature: 1, deletedAt: null, createdAt: new Date(), updatedAt: new Date() } as any, personaOverlay: { overlay_id: "main", character_id: "zuo_ran" } as any, thoughtSummaryCache: new Map(), thoughtsAcc: [], isFirstUserTurn: false, ...overrides }; }
function fakeGenEvent(type: string, data?: unknown) { return { type, ...(data ?? {}) }; }
function fakeCompleteResult(overrides?: Partial<GenerateAndValidateResult>): GenerateAndValidateResult { return { content: "Hello there.", validatorResult: { status: "pass" }, wasRewritten: false, wasDeflected: false, inputTokens: 100, outputTokens: 50, ...overrides } as GenerateAndValidateResult; }
const fakeThought: Thought = { kind: "recall", text: "A memory surfaces.", ts: Date.now() };

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> { const items: T[] = []; for await (const item of gen) items.push(item); return items; }

describe("runRoleplayGenerationAdapter", () => {
  it("handles thought/tool_call/tool_result events, suppresses deltas, captures _complete, queues recall thoughts, respects abort signal, and passes arguments", async () => {
    // thought events → frontend-safe
    let events = await collect(runRoleplayGenerationAdapter(fakeInput(), { generateAndValidate: (async function* () { yield fakeGenEvent("thought", { thought: fakeThought }); }) as any }));
    assert.equal(events.length, 1, "thought — count");
    assert.equal(events[0]!.event, "thought", "thought — event");
    assert.equal((events[0] as any).data.kind, "recall", "thought — kind");
    assert.equal((events[0] as any).data.text, "A memory surfaces.", "thought — text");

    // tool_call events → frontend-safe
    events = await collect(runRoleplayGenerationAdapter(fakeInput(), { generateAndValidate: (async function* () { yield fakeGenEvent("tool_call", { id: "t1", name: "web_search", args: { q: "test" } }); }) as any }));
    assert.equal(events.length, 1, "tool_call — count");
    assert.equal(events[0]!.event, "tool_call", "tool_call — event");
    assert.equal((events[0] as any).data.id, "t1", "tool_call — id");
    assert.equal((events[0] as any).data.name, "web_search", "tool_call — name");

    // tool_result events → frontend-safe
    events = await collect(runRoleplayGenerationAdapter(fakeInput(), { generateAndValidate: (async function* () { yield fakeGenEvent("tool_result", { id: "t1", name: "web_search", summary: "found results" }); }) as any }));
    assert.equal(events.length, 1, "tool_result — count");
    assert.equal(events[0]!.event, "tool_result", "tool_result — event");
    assert.equal((events[0] as any).data.summary, "found results", "tool_result — summary");
    assert.equal((events[0] as any).data.id, "t1", "tool_result — id");

    // Suppresses raw draft delta events
    events = await collect(runRoleplayGenerationAdapter(fakeInput(), { generateAndValidate: (async function* () { yield fakeGenEvent("delta", { text: "partial draft..." }); yield fakeGenEvent("delta", { text: " more draft..." }); }) as any }));
    assert.equal(events.length, 0, "delta — suppressed");

    // _complete event with result payload
    const result = fakeCompleteResult({ content: "Final reply." });
    events = await collect(runRoleplayGenerationAdapter(fakeInput(), { generateAndValidate: (async function* () { yield { type: "_complete", result }; }) as any }));
    assert.equal(events.length, 1, "_complete — count");
    assert.equal(events[0]!.event, "_complete", "_complete — event");
    assert.equal((events[0] as any).data.content, "Final reply.", "_complete — content");
    assert.equal((events[0] as any).data.wasRewritten, false, "_complete — wasRewritten");

    // Queued recall thoughts before each mapped event
    const recallOne: Thought = { kind: "recall", text: "Recall 1", ts: 1 };
    const recallTwo: Thought = { kind: "recall", text: "Recall 2", ts: 2 };
    let callCount = 0;
    events = await collect(runRoleplayGenerationAdapter(fakeInput({ takeReadyRecallThought: () => { callCount++; return callCount === 1 ? recallOne : callCount === 2 ? recallTwo : null; } }), { generateAndValidate: (async function* () { yield fakeGenEvent("thought", { thought: fakeThought }); yield fakeGenEvent("tool_call", { id: "t1", name: "test", args: {} }); }) as any }));
    assert.equal(events.length, 4, "recall queue — count");
    assert.equal(events[0]!.event, "thought", "recall queue — ev0");
    assert.equal((events[0] as any).data.text, "Recall 1", "recall queue — recall1");
    assert.equal((events[1] as any).data.text, "A memory surfaces.", "recall queue — fakeThought");
    assert.equal((events[2] as any).data.text, "Recall 2", "recall queue — recall2");
    assert.equal(events[3]!.event, "tool_call", "recall queue — tool_call");

    // Stops early when signal aborted during generation
    const abortController = new AbortController();
    let yieldedBeforeAbort = false;
    events = await collect(runRoleplayGenerationAdapter(fakeInput({ signal: abortController.signal }), { generateAndValidate: (async function* () { yield fakeGenEvent("thought", { thought: fakeThought }); yieldedBeforeAbort = true; abortController.abort(); yield fakeGenEvent("tool_call", { id: "t1", name: "test", args: {} }); }) as any }));
    assert.equal(yieldedBeforeAbort, true, "abort — yielded before");
    assert.equal(events.length, 1, "abort — count");
    assert.equal(events[0]!.event, "thought", "abort — event");

    // No events when signal already aborted
    const preAborted = new AbortController();
    preAborted.abort();
    events = await collect(runRoleplayGenerationAdapter(fakeInput({ signal: preAborted.signal }), { generateAndValidate: (async function* () { yield fakeGenEvent("thought", { thought: fakeThought }); }) as any }));
    assert.equal(events.length, 0, "pre-aborted — count");

    // Passes arguments to generateAndValidate
    const promptContext: PromptContext = { systemPrompt: "[SYSTEM]\nCustom.", conversationHistory: [{ role: "user", content: "hi" }] };
    const session = fakeInput().session;
    const personaOverlay = fakeInput().personaOverlay;
    const thoughtSummaryCache = new Map([["k", "v"]]);
    const thoughtsAcc: Thought[] = [{ kind: "drafting", text: "prior thought", ts: 0 }];
    let capturedInput: Record<string, unknown> | undefined;
    await collect(runRoleplayGenerationAdapter({ ...fakeInput(), promptContext, userMessage: "test message", session, personaOverlay, thoughtSummaryCache, thoughtsAcc, isFirstUserTurn: true }, { generateAndValidate: (async function* (streamInput: Record<string, unknown>) { capturedInput = streamInput; }) as any }));
    assert.ok(capturedInput, "args — captured");
    assert.equal(capturedInput!.promptContext, promptContext, "args — promptContext");
    assert.equal(capturedInput!.userMessage, "test message", "args — userMessage");
    assert.equal(capturedInput!.session, session, "args — session");
    assert.equal(capturedInput!.personaOverlay, personaOverlay, "args — personaOverlay");
    assert.equal(capturedInput!.thoughtSummaryCache, thoughtSummaryCache, "args — thoughtSummaryCache");
    assert.equal(capturedInput!.thoughtsOut, thoughtsAcc, "args — thoughtsOut");
    assert.equal(capturedInput!.isFirstUserTurn, true, "args — isFirstUserTurn");
  });
});

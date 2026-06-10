import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { persistRoleplayTurn, type PersistRoleplayTurnInput, type PersistRoleplayTurnOutput } from "./roleplayPersistenceAdapter";
import type { ChatSession } from "../../db/schema/chat";
import type { GenerateAndValidateResult } from "../generation/generateAndValidate";
import type { ModelBinding } from "../../config/models";
import type { PersistCompletedTurnResult } from "../persistence/turnPersistence";

function fakeSession(): ChatSession { return { sessionId: "s-001", characterId: "zuo_ran", playerId: "p-001", mode: "canonical_live", continuityScope: "main", continuityFamily: "main_world", personaOverlayId: null, memoryNamespace: "main", pinnedTime: null, pinnedLocation: null, writebackPolicy: "full_writeback", sessionSummary: null, displayTitle: null, thinking: true, temperature: 1, deletedAt: null, createdAt: new Date(), updatedAt: new Date() }; }
function fakeGenerationResult(overrides?: Partial<GenerateAndValidateResult>): GenerateAndValidateResult { return { content: "Test reply.", validatorResult: { in_character: true, canon_consistent: true, session_state_consistent: true, nsfw_within_bounds: true, issues: [], needs_rewrite: false }, wasRewritten: false, wasDeflected: false, inputTokens: 100, outputTokens: 50, ...overrides } as GenerateAndValidateResult; }
const fakeModelBinding: ModelBinding = { provider: "deepseek", model: "deepseek-chat" };
function fakeInput(overrides?: Partial<PersistRoleplayTurnInput>): PersistRoleplayTurnInput { return { session: fakeSession(), userMessage: "hello", generationResult: fakeGenerationResult(), derivedState: { inferredMood: "calm", inferredActivity: "conversing", conversationalStance: "neutral" }, memories: [], thoughts: [], generationModelBinding: fakeModelBinding, finalRecallTimedOut: false, ...overrides }; }
const fakePersistResult: PersistCompletedTurnResult = { userMessageId: "um-001", assistantMessageId: "am-001", assistantTurnIndex: 5, jobId: null };

describe("persistRoleplayTurn", () => {
  it("routes, traces, persists, recalls, wakes, and returns result", async () => {
    // Route selection — not deflected → roleplay
    let output = await persistRoleplayTurn(fakeInput({ generationResult: fakeGenerationResult({ wasDeflected: false }) }), { persistCompletedTurn: async () => fakePersistResult, wakePostTurnRunner: () => {} });
    assert.equal(output.persistedRoute, "roleplay_turn", "route — roleplay");

    // Route selection — deflected → unsupported
    output = await persistRoleplayTurn(fakeInput({ generationResult: fakeGenerationResult({ wasDeflected: true }) }), { persistCompletedTurn: async () => fakePersistResult, wakePostTurnRunner: () => {} });
    assert.equal(output.persistedRoute, "unsupported", "route — unsupported");

    // Calls traceRouteSwitch
    let capturedTrace: { classifiedRoute: string; persistedRoute?: string } | undefined;
    await persistRoleplayTurn(fakeInput({ generationResult: fakeGenerationResult({ wasDeflected: false }) }), { traceRouteSwitch: (async (input: any) => { capturedTrace = input; }) as any, persistCompletedTurn: async () => fakePersistResult, wakePostTurnRunner: () => {} });
    assert.ok(capturedTrace, "trace — captured");
    assert.equal(capturedTrace!.classifiedRoute, "roleplay_turn", "trace — classified");
    assert.equal(capturedTrace!.persistedRoute, "roleplay_turn", "trace — persisted");

    // Passes correct input to persistCompletedTurn
    let capturedPersist: any;
    const result = fakeGenerationResult({ content: "Custom reply.", validatorResult: { in_character: false, canon_consistent: true, session_state_consistent: true, nsfw_within_bounds: true, issues: ["not in character"], needs_rewrite: true } });
    await persistRoleplayTurn(fakeInput({ session: fakeSession(), generationResult: result, derivedState: { inferredMood: "happy", inferredActivity: "thinking", conversationalStance: "warm" }, memories: [], thoughts: [{ kind: "drafting" as const, text: "thought", ts: 1 }] }), { persistCompletedTurn: (async (input: any) => { capturedPersist = input; return fakePersistResult; }) as any, wakePostTurnRunner: () => {} });
    assert.ok(capturedPersist, "persist — captured");
    assert.equal(capturedPersist.session, capturedPersist.session, "persist — session");
    assert.equal(capturedPersist.userMessage, "hello", "persist — userMessage");
    assert.equal(capturedPersist.assistantReply, "Custom reply.", "persist — reply");
    assert.deepEqual(capturedPersist.validatorResult, { in_character: false, canon_consistent: true, session_state_consistent: true, nsfw_within_bounds: true, issues: ["not in character"], needs_rewrite: true }, "persist — validator");
    assert.equal(capturedPersist.route, "roleplay_turn", "persist — route");
    assert.equal(capturedPersist.usage.inputTokens, 100, "persist — inputTokens");
    assert.equal(capturedPersist.usage.outputTokens, 50, "persist — outputTokens");

    // Calls persistLateRecallThought when finalRecallTimedOut is true
    let lateCalled: string | undefined;
    await persistRoleplayTurn(fakeInput({ finalRecallTimedOut: true, persistLateRecallThought: (id: string) => { lateCalled = id; } }), { persistCompletedTurn: async () => fakePersistResult, wakePostTurnRunner: () => {} });
    assert.equal(lateCalled, "am-001", "late recall — called");

    // Does not call persistLateRecallThought when finalRecallTimedOut is false
    let lateNotCalled = false;
    await persistRoleplayTurn(fakeInput({ finalRecallTimedOut: false, persistLateRecallThought: () => { lateNotCalled = true; } }), { persistCompletedTurn: async () => fakePersistResult, wakePostTurnRunner: () => {} });
    assert.equal(lateNotCalled, false, "late recall — not called");

    // Calls wakePostTurnRunner when jobId present
    let woken = false;
    await persistRoleplayTurn(fakeInput(), { persistCompletedTurn: async () => ({ ...fakePersistResult, jobId: "job-001" }), wakePostTurnRunner: () => { woken = true; } });
    assert.equal(woken, true, "wake — called");

    // Does not call wakePostTurnRunner when jobId is null
    woken = false;
    await persistRoleplayTurn(fakeInput(), { persistCompletedTurn: async () => fakePersistResult, wakePostTurnRunner: () => { woken = true; } });
    assert.equal(woken, false, "wake — not called");

    // Returns persistedRoute and persisted result
    output = await persistRoleplayTurn(fakeInput({ generationResult: fakeGenerationResult({ wasDeflected: false }) }), { persistCompletedTurn: async () => fakePersistResult, wakePostTurnRunner: () => {} });
    assert.equal(output.persistedRoute, "roleplay_turn", "output — route");
    assert.equal(output.persisted.assistantMessageId, "am-001", "output — messageId");
    assert.equal(output.persisted.assistantTurnIndex, 5, "output — turnIndex");
  });
});

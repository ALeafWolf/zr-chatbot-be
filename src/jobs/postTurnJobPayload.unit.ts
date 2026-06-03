import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INITIAL_POST_TURN_STEP_STATUS, normalizeStepStatus, parsePostTurnJobPayload } from "./postTurnJobPayload";

function payload() { return { version: 1, sessionId: "s1", userMessage: "hello", assistantReply: "hi", session: { sessionId: "s1", characterId: "zuo_ran", playerId: "p1", mode: "canonical_live", continuityScope: "main_relationship", continuityFamily: "main_world", personaOverlayId: null, memoryNamespace: "main:main_relationship:p1", pinnedTime: null, pinnedLocation: null, writebackPolicy: "full_writeback", sessionSummary: null, displayTitle: null, thinking: true, temperature: 1 }, derivedState: { inferredMood: "calm", inferredActivity: "in_conversation", conversationalStance: "engaged" }, shouldWriteMemory: true, userTurnIndex: 0, assistantTurnIndex: 1, userMessageId: "u1", assistantMessageId: "a1", recentMemorySummaries: ["x"] }; }

describe("postTurnJobPayload", () => {
  it("round-trips v1, rejects unsupported versions, normalizes step status", () => {
    assert.deepEqual(parsePostTurnJobPayload(payload()), payload(), "round-trip v1");
    assert.throws(() => parsePostTurnJobPayload({ ...payload(), version: 2 }), "rejects v2");
    assert.deepEqual(normalizeStepStatus({ raw_chunk: "completed" }), { ...INITIAL_POST_TURN_STEP_STATUS, raw_chunk: "completed" }, "normalizes");
  });
});

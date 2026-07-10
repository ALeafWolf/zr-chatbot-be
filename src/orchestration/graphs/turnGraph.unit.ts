import { describe, it } from "node:test";
import assert from "node:assert";
import { createTurnGraph } from "./turnGraph";

const FAKE_RESULT = { assistantMessageId: "msg_abc123", content: "Hello from the fake runner!", wasRewritten: false, wasDeflected: false, turnIndex: 5, route: "roleplay_turn" };

describe("turnGraph - createTurnGraph", () => {
  it("passes sessionId/userMessage to runner, returns TurnOutput on success, captures errors", async () => {
    const calls: Array<{ sessionId: string; userMessage: string }> = [];
    let state = await createTurnGraph(async (input) => { calls.push({ sessionId: input.sessionId, userMessage: input.userMessage }); return FAKE_RESULT; }).invoke({ sessionId: "sess_001", userMessage: "test message" });
    assert.strictEqual(calls.length, 1, "runner called once");
    assert.strictEqual(calls[0].sessionId, "sess_001", "sessionId passed");
    assert.strictEqual(calls[0].userMessage, "test message", "userMessage passed");
    assert.deepEqual(state.result, FAKE_RESULT, "TurnOutput shape passes through");

    // Error as Error object
    state = await createTurnGraph(async () => { throw new Error("DB connection failed"); }).invoke({ sessionId: "sess_003", userMessage: "will error" });
    assert.ok(state.errors, "errors on throw");
    assert.strictEqual(state.errors[0].stage, "runExistingCharacterTurn", "error stage");
    assert.strictEqual(state.errors[0].message, "DB connection failed", "error message");
    assert.strictEqual(state.result, undefined, "no result on error");

    // Error as string
    state = await createTurnGraph(async () => { throw "string error"; }).invoke({ sessionId: "sess_004", userMessage: "throws string" });
    assert.ok(state.errors, "errors on string throw");
    assert.strictEqual(state.errors[0].message, "string error", "string error message");
  });
});

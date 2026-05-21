import { describe, it } from "node:test";
import assert from "node:assert";
import { createTurnGraph, type TurnRunner } from "./turnGraph";

const FAKE_RESULT = {
  assistantMessageId: "msg_abc123",
  content: "Hello from the fake runner!",
  wasRewritten: false,
  wasDeflected: false,
  turnIndex: 5,
  route: "roleplay_turn",
};

describe("turnGraph - createTurnGraph", () => {
  it("passes sessionId and userMessage to the injected runner", async () => {
    const calls: Array<{ sessionId: string; userMessage: string }> = [];
    const fakeRunner: TurnRunner = async (input) => {
      calls.push({ sessionId: input.sessionId, userMessage: input.userMessage });
      return FAKE_RESULT;
    };

    const graph = createTurnGraph(fakeRunner);
    await graph.invoke({
      sessionId: "sess_001",
      userMessage: "test message",
    });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].sessionId, "sess_001");
    assert.strictEqual(calls[0].userMessage, "test message");
  });

  it("returns TurnOutput-shaped result on success", async () => {
    const fakeRunner: TurnRunner = async () => FAKE_RESULT;

    const graph = createTurnGraph(fakeRunner);
    const state = await graph.invoke({
      sessionId: "sess_002",
      userMessage: "hello",
    });

    assert.ok(state.result);
    assert.strictEqual(state.result.assistantMessageId, "msg_abc123");
    assert.strictEqual(state.result.content, "Hello from the fake runner!");
    assert.strictEqual(state.result.wasRewritten, false);
    assert.strictEqual(state.result.wasDeflected, false);
    assert.strictEqual(state.result.turnIndex, 5);
    assert.strictEqual(state.result.route, "roleplay_turn");
  });

  it("captures runner errors in the errors array", async () => {
    const fakeRunner: TurnRunner = async () => {
      throw new Error("DB connection failed");
    };

    const graph = createTurnGraph(fakeRunner);
    const state = await graph.invoke({
      sessionId: "sess_003",
      userMessage: "will error",
    });

    assert.ok(state.errors);
    assert.strictEqual(state.errors.length, 1);
    assert.strictEqual(state.errors[0].stage, "runExistingCharacterTurn");
    assert.strictEqual(state.errors[0].message, "DB connection failed");
    assert.strictEqual(state.result, undefined);
  });

  it("captures non-Error throws as strings", async () => {
    const fakeRunner: TurnRunner = async () => {
      throw "string error";
    };

    const graph = createTurnGraph(fakeRunner);
    const state = await graph.invoke({
      sessionId: "sess_004",
      userMessage: "throws string",
    });

    assert.ok(state.errors);
    assert.strictEqual(state.errors[0].message, "string error");
  });
});

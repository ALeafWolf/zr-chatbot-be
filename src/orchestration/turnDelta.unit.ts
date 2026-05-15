import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveTurnDelta,
  formatTurnDelta,
  readFreshTurnDelta,
} from "./turnDelta";
import type { SessionState } from "../db/schema/chat";

function state(temporaryAssumptions: unknown): SessionState {
  return {
    sessionId: "s1",
    currentSceneContext: null,
    localRelationshipDelta: null,
    temporaryAssumptions,
    derivedState: null,
    lastTurnIndex: 10,
    updatedAt: new Date(),
  };
}

describe("turnDelta", () => {
  it("derives a short latest-turn delta without an LLM call", () => {
    const delta = deriveTurnDelta({
      userMessage: "Remember our plan next time.",
      assistantReply: "I promise I will keep it in mind.",
      userTurnIndex: 3,
      assistantTurnIndex: 4,
    });
    assert.equal(delta.kind, "latest_turn_delta");
    assert.equal(delta.sourceTurnStart, 3);
    assert.equal(delta.sourceTurnEnd, 4);
    assert.ok(delta.pendingActions.length > 0);
  });

  it("reads fresh deltas and omits expired deltas", () => {
    const delta = deriveTurnDelta({
      userMessage: "hello",
      assistantReply: "hi",
      userTurnIndex: 3,
      assistantTurnIndex: 4,
    });
    assert.equal(readFreshTurnDelta(state(delta), 5)?.sourceTurnEnd, 4);
    assert.equal(readFreshTurnDelta(state(delta), 99), null);
  });

  it("formats a prompt block body", () => {
    const delta = deriveTurnDelta({
      userMessage: "I trust you.",
      assistantReply: "Then I will stay.",
      userTurnIndex: 1,
      assistantTurnIndex: 2,
    });
    const text = formatTurnDelta(delta);
    assert.match(text, /Source turns: 1-2/);
    assert.match(text, /Latest facts/);
  });
});

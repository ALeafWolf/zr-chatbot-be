import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveTurnDelta, formatTurnDelta, readFreshTurnDelta } from "./turnDelta";

function state(temporaryAssumptions: unknown) { return { sessionId: "s1", currentSceneContext: null, localRelationshipDelta: null, temporaryAssumptions, derivedState: null, lastTurnIndex: 10, updatedAt: new Date() }; }

describe("turnDelta", () => {
  it("derives delta, reads fresh/expired, and formats prompt block", () => {
    const delta = deriveTurnDelta({ userMessage: "Remember our plan next time.", assistantReply: "I promise I will keep it in mind.", userTurnIndex: 3, assistantTurnIndex: 4 });
    const deltaFmt = deriveTurnDelta({ userMessage: "I trust you.", assistantReply: "Then I will stay.", userTurnIndex: 1, assistantTurnIndex: 2 });
    assert.equal(delta.kind, "latest_turn_delta", "derive — kind");
    assert.equal(delta.sourceTurnStart, 3, "derive — start");
    assert.equal(delta.sourceTurnEnd, 4, "derive — end");
    assert.ok(delta.pendingActions.length > 0, "derive — pendingActions");

    assert.equal(readFreshTurnDelta(state(delta), 5)?.sourceTurnEnd, 4, "read — fresh");
    assert.equal(readFreshTurnDelta(state(delta), 99), null, "read — expired");

    const text = formatTurnDelta(deltaFmt);
    assert.match(text, /Source turns: 1-2/, "format — source turns");
    assert.match(text, /Latest facts/, "format — Latest facts");
  });
});

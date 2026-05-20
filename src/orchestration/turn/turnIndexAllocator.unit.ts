import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateNextTurnIndexes } from "./turnIndexAllocator";

describe("calculateNextTurnIndexes", () => {
  it("starts empty sessions at user=0 assistant=1", () => {
    assert.deepEqual(
      calculateNextTurnIndexes({
        maxMessageTurnIndex: null,
        sessionStateLastTurnIndex: 0,
      }),
      { userTurnIndex: 0, assistantTurnIndex: 1 },
    );
  });

  it("uses existing messages when session_state is stale", () => {
    assert.deepEqual(
      calculateNextTurnIndexes({
        maxMessageTurnIndex: 5,
        sessionStateLastTurnIndex: 1,
      }),
      { userTurnIndex: 6, assistantTurnIndex: 7 },
    );
  });

  it("uses session_state when it is ahead of messages", () => {
    assert.deepEqual(
      calculateNextTurnIndexes({
        maxMessageTurnIndex: 5,
        sessionStateLastTurnIndex: 7,
      }),
      { userTurnIndex: 8, assistantTurnIndex: 9 },
    );
  });
});

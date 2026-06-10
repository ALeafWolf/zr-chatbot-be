import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateNextTurnIndexes } from "./turnIndexAllocator";

describe("calculateNextTurnIndexes", () => {
  it("handles empty, stale, and ahead session states", () => {
    const cases = [
      { name: "empty session", input: { maxMessageTurnIndex: null, sessionStateLastTurnIndex: 0 }, expected: { userTurnIndex: 0, assistantTurnIndex: 1 } },
      { name: "stale session state", input: { maxMessageTurnIndex: 5, sessionStateLastTurnIndex: 1 }, expected: { userTurnIndex: 6, assistantTurnIndex: 7 } },
      { name: "session state ahead", input: { maxMessageTurnIndex: 5, sessionStateLastTurnIndex: 7 }, expected: { userTurnIndex: 8, assistantTurnIndex: 9 } },
    ];
    for (const c of cases) {
      assert.deepEqual(calculateNextTurnIndexes(c.input), c.expected, c.name);
    }
  });
});

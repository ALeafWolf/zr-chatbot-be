import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCompletedTurnPersistenceTracePayload } from "./turnPersistence";

describe("completed turn persistence trace payload", () => {
  it("reports ids, turn indexes, job id, writeback, and transaction duration", () => {
    assert.deepEqual(
      buildCompletedTurnPersistenceTracePayload({
        result: {
          userMessageId: "u1",
          assistantMessageId: "a1",
          assistantTurnIndex: 3,
          jobId: "j1",
        },
        session: {
          sessionId: "s1",
          writebackPolicy: "full_writeback",
        },
        transactionDurationMs: 42,
      }),
      {
        userMessageId: "u1",
        assistantMessageId: "a1",
        assistantTurnIndex: 3,
        jobId: "j1",
        sessionId: "s1",
        writebackEnabled: true,
        transactionDurationMs: 42,
      },
    );
  });
});

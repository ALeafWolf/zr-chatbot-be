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
        route: "roleplay_turn",
        transactionDurationMs: 42,
      }),
      {
        userMessageId: "u1",
        assistantMessageId: "a1",
        assistantTurnIndex: 3,
        jobId: "j1",
        sessionId: "s1",
        route: "roleplay_turn",
        writebackEnabled: true,
        transactionDurationMs: 42,
      },
    );
  });

  it("reports writeback disabled for unsupported route even when session allows writeback", () => {
    const payload = buildCompletedTurnPersistenceTracePayload({
      result: {
        userMessageId: "u1",
        assistantMessageId: "a1",
        assistantTurnIndex: 3,
        jobId: null,
      },
      session: {
        sessionId: "s1",
        writebackPolicy: "full_writeback",
      },
      route: "unsupported",
      transactionDurationMs: 42,
    });

    assert.equal(payload.route, "unsupported");
    assert.equal(payload.writebackEnabled, false);
    assert.equal(payload.jobId, null);
  });
});

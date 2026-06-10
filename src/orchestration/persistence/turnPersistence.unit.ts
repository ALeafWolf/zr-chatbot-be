import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCompletedTurnPersistenceTracePayload } from "./turnPersistence";

describe("completed turn persistence trace payload", () => {
  it("reports ids/indexes/job/writeback/duration and disables writeback for unsupported routes", () => {
    // Supported route with writeback policy → full payload, writeback enabled
    assert.deepEqual(
      buildCompletedTurnPersistenceTracePayload({
        result: { userMessageId: "u1", assistantMessageId: "a1", assistantTurnIndex: 3, jobId: "j1" },
        session: { sessionId: "s1", writebackPolicy: "full_writeback" },
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
      "supported route — full payload",
    );

    // Unsupported route even with writeback policy → writeback disabled, jobId null preserved
    const unsupported = buildCompletedTurnPersistenceTracePayload({
      result: { userMessageId: "u1", assistantMessageId: "a1", assistantTurnIndex: 3, jobId: null },
      session: { sessionId: "s1", writebackPolicy: "full_writeback" },
      route: "unsupported",
      transactionDurationMs: 42,
    });
    assert.equal(unsupported.route, "unsupported", "unsupported — route");
    assert.equal(unsupported.writebackEnabled, false, "unsupported — writeback disabled");
    assert.equal(unsupported.jobId, null, "unsupported — jobId null");
  });
});

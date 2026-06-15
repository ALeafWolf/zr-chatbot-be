import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCompletedTurnPersistenceTracePayload,
  shouldEnqueuePostTurnJob,
} from "./turnPersistence";
import type { ShouldEnqueuePostTurnJobInput } from "./turnPersistence";

// ---------------------------------------------------------------------------
// Enqueue gate tests — exercises the REAL exported helper (review-001 F1)
// The full persistCompletedTurn function has deep Drizzle ORM integration;
// the gate logic is extracted into the pure shouldEnqueuePostTurnJob helper
// that production code uses, so we can test it directly here.
// ---------------------------------------------------------------------------

function makeGateInput(
  overrides?: Partial<ShouldEnqueuePostTurnJobInput>,
): ShouldEnqueuePostTurnJobInput {
  return {
    shouldRunPostTurn: true,
    hasDerivedState: true,
    shouldWriteMemory: true,
    engineEnabled: false,
    ...overrides,
  };
}

describe("shouldEnqueuePostTurnJob — TG1 gateway helper", () => {

  it("enqueues for no_writeback when engine is on", () => {
    // no_writeback → shouldWriteMemory: false, but engineEnabled: true
    assert.equal(
      shouldEnqueuePostTurnJob(makeGateInput({
        shouldWriteMemory: false,
        engineEnabled: true,
      })),
      true,
      "sandbox + engine on → enqueue",
    );
  });

  it("does not enqueue for no_writeback when engine is off", () => {
    assert.equal(
      shouldEnqueuePostTurnJob(makeGateInput({
        shouldWriteMemory: false,
        engineEnabled: false,
      })),
      false,
      "sandbox + engine off → no enqueue",
    );
  });

  it("enqueues for writeback session (regardless of engine flag)", () => {
    // shouldWriteMemory: true → enqueues even with engine off
    assert.equal(
      shouldEnqueuePostTurnJob(makeGateInput({
        shouldWriteMemory: true,
        engineEnabled: false,
      })),
      true,
      "writeback + engine off → enqueue",
    );
    assert.equal(
      shouldEnqueuePostTurnJob(makeGateInput({
        shouldWriteMemory: true,
        engineEnabled: true,
      })),
      true,
      "writeback + engine on → enqueue",
    );
  });

  it("does not enqueue for non-roleplay route", () => {
    assert.equal(
      shouldEnqueuePostTurnJob(makeGateInput({
        shouldRunPostTurn: false,
        shouldWriteMemory: false,
        engineEnabled: true,
      })),
      false,
      "non-roleplay route → no enqueue",
    );
  });

  it("does not enqueue when derivedState is missing", () => {
    assert.equal(
      shouldEnqueuePostTurnJob(makeGateInput({
        hasDerivedState: false,
        shouldWriteMemory: false,
        engineEnabled: true,
      })),
      false,
      "missing derivedState → no enqueue",
    );
  });
});

// ---------------------------------------------------------------------------
// Existing trace-payload tests (unchanged)
// ---------------------------------------------------------------------------

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

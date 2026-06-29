import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readAxisState,
  parsePersistedAxisState,
  mergeAxisStateIntoDelta,
  persistAxisSnapshotTx,
} from "./axisStatePersistence";
import type { AxisPersistenceTx } from "./axisStatePersistence";
import { HISTORY_CAP } from "./constants";
import type { PersistedAxisState } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidRaw(overrides?: Partial<PersistedAxisState>): Record<string, unknown> {
  return {
    version: 1,
    tick: 42,
    axes: { connection: 0.3, valence: -0.1, arousal: 0.05, restraint: 0.6 },
    lastTrace: {
      tick: 42,
      axesBefore: { connection: 0.2, valence: 0, arousal: 0, restraint: 0.5 },
      axesAfter: { connection: 0.3, valence: -0.1, arousal: 0.05, restraint: 0.6 },
      couplingsFired: [],
      effectiveBaselines: {},
    },
    bands: { connection: "mid", valence: "low", arousal: "mid", restraint: "high" } as const,
    history: [],
    ...overrides,
  };
}

function fakeSessionRow(
  localRelationshipDelta: Record<string, unknown> | null,
) {
  return {
    sessionId: "test-session",
    localRelationshipDelta,
    derivedState: null,
    currentSceneContext: null,
    temporaryAssumptions: null,
    lastTurnIndex: 0,
    updatedAt: new Date(),
  };
}

function makeValidState(overrides?: Partial<PersistedAxisState>): PersistedAxisState {
  const raw = makeValidRaw(overrides);
  return raw as unknown as PersistedAxisState;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("axisStatePersistence — TG2", () => {

  // ===================================================================
  // readAxisState — null/absent cases
  // ===================================================================

  describe("readAxisState — absent / corrupt", () => {

    it("returns null when row is null", () => {
      assert.equal(readAxisState(null), null);
    });

    it("returns null when localRelationshipDelta is null", () => {
      assert.equal(readAxisState(fakeSessionRow(null)), null);
    });

    it("returns null when axis_state key is missing", () => {
      assert.equal(readAxisState(fakeSessionRow({ other_key: "hello" })), null);
    });

    it("returns null when axis_state is not an object", () => {
      assert.equal(readAxisState(fakeSessionRow({ axis_state: "string instead of object" })), null);
    });

    it("returns null when axis_state version is wrong", () => {
      const raw = makeValidRaw({ version: 2 as never });
      assert.equal(readAxisState(fakeSessionRow({ axis_state: raw })), null);
    });
  });

  // ===================================================================
  // readAxisState — lastTrace corruption (F4)
  // ===================================================================

  describe("readAxisState — lastTrace corruption (F4)", () => {

    it("returns null when lastTrace is missing", () => {
      const raw = makeValidRaw({ lastTrace: undefined as never });
      assert.equal(readAxisState(fakeSessionRow({ axis_state: raw })), null);
    });

    it("returns null when lastTrace is a string", () => {
      const raw = makeValidRaw({ lastTrace: "not-an-object" as never });
      assert.equal(readAxisState(fakeSessionRow({ axis_state: raw })), null);
    });

    it("returns null when lastTrace.couplingsFired is not an array", () => {
      const raw = makeValidRaw({
        lastTrace: { tick: 0, axesBefore: {}, axesAfter: {}, couplingsFired: "not-array", effectiveBaselines: {} } as never,
      });
      assert.equal(readAxisState(fakeSessionRow({ axis_state: raw })), null);
    });

    it("returns null when lastTrace.effectiveBaselines is not an object", () => {
      const raw = makeValidRaw({
        lastTrace: { tick: 0, axesBefore: {}, axesAfter: {}, couplingsFired: [], effectiveBaselines: null } as never,
      });
      assert.equal(readAxisState(fakeSessionRow({ axis_state: raw })), null);
    });
  });

  // ===================================================================
  // readAxisState — happy path
  // ===================================================================

  describe("readAxisState — happy path", () => {

    it("reads and parses a valid axis_state", () => {
      const raw = makeValidRaw();
      const result = readAxisState(fakeSessionRow({ axis_state: raw }));
      assert.ok(result !== null, "should parse successfully");
      assert.equal(result.version, 1);
      assert.equal(result.tick, 42);
      assert.equal(result.axes.connection, 0.3);
      assert.equal(result.axes.restraint, 0.6);
      assert.equal(result.bands.restraint, "high");
      assert.equal(result.lastTrace.tick, 42);
      assert.deepEqual(result.lastTrace.couplingsFired, []);
    });

    it("extracts axis_state from delta with unrelated sibling keys", () => {
      const raw = makeValidRaw();
      const delta: Record<string, unknown> = {
        axis_state: raw,
        other_data: { key: "value" },
        nested: { foo: 1 },
      };
      const result = readAxisState(fakeSessionRow(delta));
      assert.ok(result !== null, "should parse");
      assert.equal(result.axes.connection, 0.3);
    });
  });

  // ===================================================================
  // parsePersistedAxisState — field coercion
  // ===================================================================

  describe("parsePersistedAxisState — coercion", () => {

    it("coerces missing/invalid numeric fields to 0", () => {
      const raw = makeValidRaw({
        axes: { connection: "abc" as never, valence: null as never, arousal: undefined as never, restraint: 0.6 },
      });
      const result = parsePersistedAxisState(raw);
      assert.ok(result !== null);
      assert.equal(result.axes.connection, 0, "non-numeric connection defaults to 0");
      assert.equal(result.axes.valence, 0, "null valence defaults to 0");
      assert.equal(result.axes.arousal, 0, "undefined arousal defaults to 0");
      assert.equal(result.axes.restraint, 0.6, "valid restraint stays 0.6");
    });

    it("coerces missing/invalid bands to mid", () => {
      const raw = makeValidRaw({
        bands: { connection: "high" as const, valence: "invalid" as never, arousal: null as never, restraint: undefined as never },
      });
      const result = parsePersistedAxisState(raw);
      assert.ok(result !== null);
      assert.equal(result.bands.connection, "high");
      assert.equal(result.bands.valence, "mid", "invalid band defaults to mid");
      assert.equal(result.bands.arousal, "mid", "null band defaults to mid");
      assert.equal(result.bands.restraint, "mid", "undefined band defaults to mid");
    });

    it("handles missing axes", () => {
      const raw = makeValidRaw({ axes: undefined as never });
      const result = parsePersistedAxisState(raw);
      assert.ok(result !== null, "should parse with zero axes");
      assert.equal(result.axes.connection, 0);
      assert.equal(result.axes.valence, 0);
      assert.equal(result.axes.arousal, 0);
      assert.equal(result.axes.restraint, 0);
    });
  });

  // ===================================================================
  // History cap (read-side)
  // ===================================================================

  describe("history cap (read-side)", () => {

    it("truncates history to HISTORY_CAP (6)", () => {
      const longHistory = Array.from({ length: 20 }, (_, i) => ({
        tick: i,
        axes: { connection: 0, valence: 0, arousal: 0, restraint: 0 },
      }));
      const raw = makeValidRaw({ history: longHistory });
      const result = parsePersistedAxisState(raw);
      assert.ok(result !== null);
      assert.equal(result.history.length, HISTORY_CAP, `history truncated to ${HISTORY_CAP}`);
      assert.equal(result.history[0].tick, 14, "first retained entry tick");
      assert.equal(result.history[result.history.length - 1].tick, 19, "last retained entry tick");
    });

    it("preserves history when under cap", () => {
      const shortHistory = Array.from({ length: 3 }, (_, i) => ({
        tick: i,
        axes: { connection: 0, valence: 0, arousal: 0, restraint: 0 },
      }));
      const raw = makeValidRaw({ history: shortHistory });
      const result = parsePersistedAxisState(raw);
      assert.ok(result !== null);
      assert.equal(result.history.length, 3);
    });

    it("handles non-array history gracefully", () => {
      const raw = makeValidRaw({ history: "not-an-array" as never });
      const result = parsePersistedAxisState(raw);
      assert.ok(result !== null);
      assert.deepEqual(result.history, [], "non-array history defaults to []");
    });
  });

  // ===================================================================
  // Tick number
  // ===================================================================

  it("coerces missing tick to 0", () => {
    const raw = makeValidRaw({ tick: undefined as never });
    const result = parsePersistedAxisState(raw);
    assert.ok(result !== null);
    assert.equal(result.tick, 0, "missing tick defaults to 0");
  });

  // ===================================================================
  // mergeAxisStateIntoDelta — pure merge helper (F5)
  // ===================================================================

  describe("mergeAxisStateIntoDelta — write-side merge (F5)", () => {

    it("preserves unrelated sibling keys", () => {
      const existing = {
        some_other_key: "hello",
        nested: { foo: 1 },
      };
      const state = makeValidState();
      const merged = mergeAxisStateIntoDelta(existing, state);

      assert.equal(merged.some_other_key, "hello", "sibling key preserved");
      assert.deepEqual(merged.nested, { foo: 1 }, "nested sibling key preserved");
      assert.ok(merged.axis_state !== undefined, "axis_state key present");
    });

    it("replaces previous axis_state", () => {
      const existing = {
        axis_state: { version: 1, tick: 1 } as unknown as PersistedAxisState,
        other: "keep",
      };
      const state = makeValidState({ tick: 99 });
      const merged = mergeAxisStateIntoDelta(existing, state);

      assert.equal(merged.other, "keep", "unrelated key kept");
      assert.deepEqual(
        (merged.axis_state as PersistedAxisState).tick,
        99,
        "axis_state replaced with new value",
      );
    });

    it("caps history at write time", () => {
      const longHistory = Array.from({ length: 20 }, (_, i) => ({
        tick: i,
        axes: { connection: 0, valence: 0, arousal: 0, restraint: 0 },
      }));
      const state = makeValidState({ history: longHistory });
      const merged = mergeAxisStateIntoDelta({}, state);

      const written = merged.axis_state as PersistedAxisState;
      assert.equal(written.history.length, HISTORY_CAP, "history capped at write");
      assert.equal(written.history[0].tick, 14, "first retained entry");
    });

    it("preserves history when under cap at write", () => {
      const shortHistory = Array.from({ length: 3 }, (_, i) => ({
        tick: i,
        axes: { connection: 0, valence: 0, arousal: 0, restraint: 0 },
      }));
      const state = makeValidState({ history: shortHistory });
      const merged = mergeAxisStateIntoDelta({}, state);

      const written = merged.axis_state as PersistedAxisState;
      assert.equal(written.history.length, 3, "history preserved when under cap");
    });

    it("round-trips through parsePersistedAxisState", () => {
      const original = makeValidState();
      const merged = mergeAxisStateIntoDelta({}, original);

      const reparsed = parsePersistedAxisState(merged.axis_state);
      assert.ok(reparsed !== null, "round-trip parse succeeds");
      assert.equal(reparsed.tick, original.tick);
      assert.equal(reparsed.axes.connection, original.axes.connection);
      assert.equal(reparsed.axes.restraint, original.axes.restraint);
      assert.deepEqual(reparsed.lastTrace.couplingsFired, original.lastTrace.couplingsFired);
      assert.deepEqual(reparsed.bands, original.bands);
    });

    it("handles empty existing delta", () => {
      const state = makeValidState();
      const merged = mergeAxisStateIntoDelta({}, state);

      assert.deepEqual(Object.keys(merged), ["axis_state"], "only axis_state key in result");
      assert.deepEqual(
        (merged.axis_state as PersistedAxisState).tick,
        state.tick,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // D4 — persistAxisSnapshotTx message-update verification
  // ---------------------------------------------------------------------------

  describe("persistAxisSnapshotTx — message-update verification (D4)", () => {
    /** Build a fake transaction object that reads from the given mock state. */
    function fakeTx(overrides?: {
      selectRows?: Array<Record<string, unknown>>;
      updateReturning?: unknown[];
    }): AxisPersistenceTx {
      const selectRows = overrides?.selectRows ?? [{ localRelationshipDelta: { existing_key: "keep" } }];
      const updateReturning = overrides?.updateReturning ?? [{ id: "msg-123" }];
      return {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve(selectRows),
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            onConflictDoUpdate: () => Promise.resolve(),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => ({
              returning: () => Promise.resolve(updateReturning),
            }),
          }),
        }),
      };
    }

    const validState = {
      version: 1 as const,
      tick: 0,
      axes: { connection: 0, valence: 0, arousal: 0, restraint: 0 },
      lastTrace: {
        tick: 0,
        axesBefore: { connection: 0, valence: 0, arousal: 0, restraint: 0 },
        axesAfter: { connection: 0, valence: 0, arousal: 0, restraint: 0 },
        couplingsFired: [],
        effectiveBaselines: {},
      },
      bands: { connection: "mid" as const, valence: "mid" as const, arousal: "mid" as const, restraint: "mid" as const },
      history: [],
    };

    const validSnapshot = {
      version: 1 as const,
      source: "post_turn_engine" as const,
      tick: 0,
      scope: "test",
      axes: { connection: 0, valence: 0, arousal: 0, restraint: 0 },
      bands: { connection: "mid" as const, valence: "mid" as const, arousal: "mid" as const, restraint: "mid" as const },
    };

    it("succeeds when assistant message row is found", async () => {
      await assert.doesNotReject(() =>
        persistAxisSnapshotTx(
          fakeTx(),
          "session-1",
          "msg-123",
          validState,
          validSnapshot,
        ),
      );
    });

    it("throws when assistant message row is not found (empty returning)", async () => {
      await assert.rejects(
        () =>
          persistAxisSnapshotTx(
            fakeTx({ updateReturning: [] }),
            "session-1",
            "msg-999",
            validState,
            validSnapshot,
          ),
        /assistant message "msg-999" not found/,
      );
    });
  });
});

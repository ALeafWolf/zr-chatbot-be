import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { AxisName, Band, CharacterStateAxes } from "../../state/emotionalEngine/types";

// ---------------------------------------------------------------------------
// Mutable mock objects — mocked once at module level, mutated per test
// ---------------------------------------------------------------------------

let mockSessionRows: Array<{
  characterId: string;
  continuityScope: string;
  updatedAt: Date;
}> = [];

let mockStateRow: Record<string, unknown> | null = null;

let engineEnabled = true;

let hasEmotionalAxes = true;

let loadCharacterDefaultsCallCount = 0;

/** Mutable coupling array for the mock — mutated per test to exercise empty/absent cases (F1). */
let mockCouplings: unknown[] | undefined = [
  { id: "zr_c1", label: "紧张自守", description: "情绪一旦被搅动…", source: "arousal", target: "restraint", effect_type: "direct_delta", coefficient: 0.6, derived_from: "defense_mechanism" },
  { id: "zr_c2", label: "亲近松动", description: "当亲近升高且情绪为正时…", source: "connection", target: "restraint", effect_type: "baseline_shift", coefficient: -0.4, derived_from: "transition_rule" },
  { id: "zr_c3", label: "失控自守", description: "当情绪明显转负时…", source: "valence", target: "restraint", effect_type: "direct_delta", coefficient: -0.5, derived_from: "core_fear" },
];

mock.module("../../db/client", {
  namedExports: {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(mockSessionRows),
          }),
        }),
      }),
    },
  },
});

mock.module("../../state/sessionStateRepo", {
  namedExports: {
    getSessionState: (_sessionId: string) => Promise.resolve(mockStateRow),
  },
});

mock.module("../../character/characterDefaults", {
  namedExports: {
    loadCharacterDefaults: (_characterId: string) => {
      loadCharacterDefaultsCallCount++;
      const defaults: Record<string, unknown> = {
        emotional_axes_baseline_by_scope: {
          main_relationship: { connection: 0.15, valence: 0.05, arousal: 0, restraint: 0.7 },
          main_married: { connection: 0.35, valence: 0.15, arousal: 0, restraint: 0.55 },
        },
        emotional_coupling: mockCouplings,
      };
      if (hasEmotionalAxes) {
        defaults.emotional_axes = {
          connection: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
          valence: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
          arousal: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
          restraint: { baseline: 0.7, driftRate: 0.02, min: -1, max: 1 },
        };
      }
      return defaults;
    },
  },
});

mock.module("../../config/env", {
  namedExports: {
    env: new Proxy({}, {
      get(_target, prop) {
        if (prop === "EMOTIONAL_ENGINE_ENABLED") return engineEnabled;
        return undefined;
      },
    }),
  },
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  loadCharacterDefaultsCallCount = 0;
  hasEmotionalAxes = true;
  mockCouplings = [
    { id: "zr_c1", label: "紧张自守", description: "情绪一旦被搅动…", source: "arousal", target: "restraint", effect_type: "direct_delta", coefficient: 0.6, derived_from: "defense_mechanism" },
    { id: "zr_c2", label: "亲近松动", description: "当亲近升高且情绪为正时…", source: "connection", target: "restraint", effect_type: "baseline_shift", coefficient: -0.4, derived_from: "transition_rule" },
    { id: "zr_c3", label: "失控自守", description: "当情绪明显转负时…", source: "valence", target: "restraint", effect_type: "direct_delta", coefficient: -0.5, derived_from: "core_fear" },
  ];
}

function setDefaultSession() {
  resetMocks();
  mockSessionRows = [
    {
      characterId: "zuo_ran",
      continuityScope: "main_relationship",
      updatedAt: new Date("2026-06-15T12:00:00Z"),
    },
  ];
}

function setMarriedSession() {
  mockSessionRows = [
    {
      characterId: "zuo_ran",
      continuityScope: "main_married",
      updatedAt: new Date("2026-06-15T12:00:00Z"),
    },
  ];
}

function setEmptySession() {
  mockSessionRows = [];
}

function makePersistedStateRow(): Record<string, unknown> {
  return {
    sessionId: "test-session",
    localRelationshipDelta: {
      axis_state: {
        version: 1,
        tick: 7,
        axes: { connection: 0.21, valence: 0.08, arousal: -0.03, restraint: 0.61 },
        lastTrace: {
          tick: 7,
          axesBefore: { connection: 0.15, valence: 0.05, arousal: 0, restraint: 0.7 },
          axesAfter: { connection: 0.21, valence: 0.08, arousal: -0.03, restraint: 0.61 },
          couplingsFired: ["zr_c2"],
          effectiveBaselines: { restraint: 0.44 },
          event: { type: "user_pursues_connection", intensity: 0.6, reason: "they leaned in" },
        },
        bands: { connection: "mid", valence: "mid", arousal: "mid", restraint: "mid" } as Record<AxisName, Band>,
        history: [
          { tick: 5, axes: { connection: 0.1, valence: 0.02, arousal: 0, restraint: 0.7 } },
          { tick: 6, axes: { connection: 0.18, valence: 0.06, arousal: -0.01, restraint: 0.65 } },
        ],
      },
    },
    derivedState: null,
    currentSceneContext: null,
    temporaryAssumptions: null,
    lastTurnIndex: 7,
    updatedAt: new Date("2026-06-15T12:00:05Z"),
  };
}

function makeEmptyStateRow(): Record<string, unknown> {
  return {
    sessionId: "test-session",
    localRelationshipDelta: null,
    derivedState: null,
    currentSceneContext: null,
    temporaryAssumptions: null,
    lastTurnIndex: 0,
    updatedAt: new Date("2026-06-15T12:00:05Z"),
  };
}

function makeCorruptStateRow(): Record<string, unknown> {
  return {
    sessionId: "test-session",
    localRelationshipDelta: {
      axis_state: { version: 999, tick: 0, axes: {}, lastTrace: null },
    },
    derivedState: null,
    currentSceneContext: null,
    temporaryAssumptions: null,
    lastTurnIndex: 0,
    updatedAt: new Date("2026-06-15T12:00:05Z"),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getAxisState — TG1", () => {

  // ===================================================================
  // Persisted path
  // ===================================================================

  it("returns persisted axis state when available with engine on", async () => {
    setDefaultSession();
    mockStateRow = makePersistedStateRow();
    engineEnabled = true;
    loadCharacterDefaultsCallCount = 0;

    const { getAxisState } = await import("./sessionService");
    const result = await getAxisState("test-session");

    assert.ok(result !== null);
    assert.equal(result.session_id, "test-session");
    assert.equal(result.enabled, true);
    assert.equal(result.source, "persisted");
    assert.equal(result.scope, "main_relationship");
    assert.equal(result.tick, 7);
    assert.deepEqual(result.axes, { connection: 0.21, valence: 0.08, arousal: -0.03, restraint: 0.61 });
    assert.deepEqual(result.bands, { connection: "mid", valence: "mid", arousal: "mid", restraint: "mid" });
    assert.equal(result.history.length, 2);
    assert.equal(result.history[1].tick, 6);

    // baselines are scope-resolved (main_relationship overrides)
    assert.equal(result.baselines.connection, 0.15);
    assert.equal(result.baselines.restraint, 0.7);

    // last_trace: event reason dropped, couplings snake_cased
    assert.ok(result.last_trace !== null);
    assert.deepEqual(result.last_trace.event, { type: "user_pursues_connection", intensity: 0.6 });
    assert.deepEqual(result.last_trace.couplings_fired, ["zr_c2"]);
    assert.deepEqual(result.last_trace.effective_baselines, { restraint: 0.44 });

    assert.ok(result.updated_at.endsWith("Z") || result.updated_at.includes("+"));
  });

  // ===================================================================
  // Baseline path (fresh session / no axis_state)
  // ===================================================================

  it("returns scope-baseline projection when no persisted axis state", async () => {
    setDefaultSession();
    mockStateRow = makeEmptyStateRow();
    engineEnabled = true;

    const { getAxisState } = await import("./sessionService");
    const result = await getAxisState("test-session");

    assert.ok(result !== null);
    assert.equal(result.source, "baseline");
    assert.equal(result.tick, 0);
    assert.equal(result.enabled, true);

    // axes match scope baselines (main_relationship: connection 0.15, valence 0.05, arousal 0, restraint 0.7)
    assert.equal(result.axes.connection, 0.15);
    assert.equal(result.axes.valence, 0.05);
    assert.equal(result.axes.arousal, 0);
    assert.equal(result.axes.restraint, 0.7);

    // bands computed from baselines: connection=0.15 centered→mid, valence=0.05→mid, arousal=0→mid, restraint=0.7→high
    assert.equal(result.bands.connection, "mid");
    assert.equal(result.bands.valence, "mid");
    assert.equal(result.bands.arousal, "mid");
    assert.equal(result.bands.restraint, "high");

    assert.deepEqual(result.baselines, result.axes);
    assert.deepEqual(result.history, []);
    assert.equal(result.last_trace, null);
  });

  // ===================================================================
  // Per-scope baseline overrides
  // ===================================================================

  it("resolves baselines per scope (main_married)", async () => {
    setMarriedSession();
    mockStateRow = makeEmptyStateRow();
    engineEnabled = true;

    const { getAxisState } = await import("./sessionService");
    const result = await getAxisState("test-session");

    assert.ok(result !== null);
    assert.equal(result.source, "baseline");

    // main_married: connection=0.35, valence=0.15, arousal=0, restraint=0.55
    assert.equal(result.axes.connection, 0.35);
    assert.equal(result.axes.valence, 0.15);
    assert.equal(result.axes.arousal, 0);
    assert.equal(result.axes.restraint, 0.55);

    // restraint 0.55 < 0.65 → mid (not high)
    assert.equal(result.bands.restraint, "mid");
    assert.equal(result.bands.connection, "mid"); // 0.35 centered, equals threshold → mid
  });

  // ===================================================================
  // Unknown session => null/404
  // ===================================================================

  it("returns null for unknown session (404)", async () => {
    setEmptySession();

    const { getAxisState } = await import("./sessionService");
    const result = await getAxisState("non-existent");

    assert.equal(result, null);
  });

  // ===================================================================
  // Corrupt persisted state => baseline (no throw)
  // ===================================================================

  it("degrades to baselines when persisted state is corrupt (version mismatch)", async () => {
    setDefaultSession();
    mockStateRow = makeCorruptStateRow();
    engineEnabled = true;

    const { getAxisState } = await import("./sessionService");
    const result = await getAxisState("test-session");

    assert.ok(result !== null);
    assert.equal(result.source, "baseline");
    // Should not throw — degrades gracefully
    assert.equal(result.tick, 0);
    assert.equal(result.axes.connection, 0.15);
    assert.equal(result.last_trace, null);
  });

  // ===================================================================
  // Engine disabled => enabled:false + baseline projection
  // ===================================================================

  it("returns enabled:false with baseline projection when engine flag is off", async () => {
    setDefaultSession();
    mockStateRow = makePersistedStateRow();
    engineEnabled = false;

    const { getAxisState } = await import("./sessionService");
    const result = await getAxisState("test-session");

    assert.ok(result !== null);
    assert.equal(result.enabled, false);
    assert.equal(result.source, "baseline");
    assert.equal(result.tick, 0);
    // Still returns scope baselines
    assert.equal(result.axes.connection, 0.15);
    assert.equal(result.last_trace, null);
  });

  // ===================================================================
  // Coupling glossary (design T2)
  // ===================================================================

  it("returns coupling_glossary with entries for all three zr couplings", async () => {
    setDefaultSession();
    mockStateRow = makeEmptyStateRow();
    engineEnabled = true;

    const { getAxisState } = await import("./sessionService");
    const result = await getAxisState("test-session");

    assert.ok(result !== null);
    assert.ok(result.coupling_glossary, "coupling_glossary present");
    // All three 左然 couplings with label should appear
    assert.ok(result.coupling_glossary.zr_c1, "zr_c1 in glossary");
    assert.equal(result.coupling_glossary.zr_c1.label, "紧张自守");
    assert.ok(result.coupling_glossary.zr_c1.description.length > 0);
    assert.ok(result.coupling_glossary.zr_c2, "zr_c2 in glossary");
    assert.equal(result.coupling_glossary.zr_c2.label, "亲近松动");
    assert.ok(result.coupling_glossary.zr_c3, "zr_c3 in glossary");
    assert.equal(result.coupling_glossary.zr_c3.label, "失控自守");
  });

  it("returns coupling_glossary on persisted path", async () => {
    setDefaultSession();
    mockStateRow = makePersistedStateRow();
    engineEnabled = true;

    const { getAxisState } = await import("./sessionService");
    const result = await getAxisState("test-session");

    assert.ok(result !== null);
    assert.equal(result.source, "persisted");
    assert.ok(result.coupling_glossary.zr_c1, "glossary present on persisted path");
  });

  it("returns coupling_glossary on engine-off path", async () => {
    setDefaultSession();
    engineEnabled = false;

    const { getAxisState } = await import("./sessionService");
    const result = await getAxisState("test-session");

    assert.ok(result !== null);
    assert.equal(result.enabled, false);
    assert.ok(result.coupling_glossary.zr_c1, "glossary present on engine-off path");
  });

  it("returns empty coupling_glossary when emotional_coupling is undefined", async () => {
    setDefaultSession();
    mockCouplings = undefined; // no emotional_coupling field
    mockStateRow = makeEmptyStateRow();
    engineEnabled = true;

    const { getAxisState } = await import("./sessionService");
    const result = await getAxisState("test-session");

    assert.ok(result !== null);
    assert.deepEqual(result.coupling_glossary, {}, "empty glossary when couplings is undefined");
  });

  it("returns empty coupling_glossary when emotional_coupling is empty array", async () => {
    setDefaultSession();
    mockCouplings = []; // empty array
    mockStateRow = makeEmptyStateRow();
    engineEnabled = true;

    const { getAxisState } = await import("./sessionService");
    const result = await getAxisState("test-session");

    assert.ok(result !== null);
    assert.deepEqual(result.coupling_glossary, {}, "empty glossary when couplings is empty array");
  });

  it("excludes couplings without a label from glossary", async () => {
    setDefaultSession();
    mockCouplings = [{ id: "zr_x1", source: "connection", target: "restraint", effect_type: "direct_delta", coefficient: 0.5, derived_from: "test" }]; // no label
    mockStateRow = makeEmptyStateRow();
    engineEnabled = true;

    const { getAxisState } = await import("./sessionService");
    const result = await getAxisState("test-session");

    assert.ok(result !== null);
    assert.deepEqual(result.coupling_glossary, {}, "coupling without label is excluded");
  });

  // ===================================================================
  // TG2: enabled:false for unconfigured characters
  // ===================================================================

  it("returns enabled:false with baseline axes when character has no emotional_axes and engine is on", async () => {
    setDefaultSession();
    hasEmotionalAxes = false;
    mockStateRow = makeEmptyStateRow();
    engineEnabled = true;

    const { getAxisState } = await import("./sessionService");
    const result = await getAxisState("test-session");

    assert.ok(result !== null, "result should not be null");
    assert.equal(result.enabled, false, "enabled is false for unconfigured character");
    assert.equal(result.source, "baseline", "source remains baseline (no union widen)");
    assert.equal(result.tick, 0, "tick is 0");
    // Still resolves scope baselines for display
    assert.equal(result.axes.connection, 0.15, "baseline connection resolved");
    assert.equal(result.axes.restraint, 0.7, "baseline restraint resolved");
    assert.deepEqual(result.history, [], "history empty");
    assert.equal(result.last_trace, null, "no last_trace");
    // Glossary still populated from emotional_coupling (separate field)
    assert.ok(result.coupling_glossary.zr_c1, "glossary still present");
  });

  it("returns enabled:true for configured character with engine on (baseline path)", async () => {
    setDefaultSession();
    hasEmotionalAxes = true;
    mockStateRow = makeEmptyStateRow();
    engineEnabled = true;

    const { getAxisState } = await import("./sessionService");
    const result = await getAxisState("test-session");

    assert.ok(result !== null, "result should not be null");
    assert.equal(result.enabled, true, "enabled is true for configured character");
    assert.equal(result.source, "baseline", "source is baseline");
    assert.equal(result.tick, 0, "tick is 0");
    assert.equal(result.axes.connection, 0.15, "baseline connection resolved");
    assert.equal(result.axes.restraint, 0.7, "baseline restraint resolved");
  });
});

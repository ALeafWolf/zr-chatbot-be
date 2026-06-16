import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveEmotionalRenderInputs } from "./resolveEmotionalRenderInputs";
import type { AxesConfig, ScopeBaselineOverrides } from "./types";

const BASE: AxesConfig = {
  connection: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
  valence: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
  arousal: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
  restraint: { baseline: 0.7, driftRate: 0.02, min: -1, max: 1 },
};

const BY_SCOPE: ScopeBaselineOverrides = {
  main_relationship: { connection: 0.15, valence: 0.05, restraint: 0.7 },
  main_married: { connection: 0.35, valence: 0.15, arousal: 0.0, restraint: 0.55 },
};

describe("resolveEmotionalRenderInputs — TG4b", () => {
  it("returns null when no axesConfig", () => {
    const result = resolveEmotionalRenderInputs(null, undefined, undefined, "main");
    assert.equal(result, null);
  });

  it("returns render-from-baselines when no persisted state", () => {
    const result = resolveEmotionalRenderInputs(null, BASE, BY_SCOPE, "main_relationship");
    assert.ok(result !== null);
    // main_relationship: connection 0.15 (centered, between -0.35 and +0.35 → mid)
    assert.equal(result.emotionalAxisBands.connection, "mid");
    // main_relationship: valence 0.05 (centered, between -0.35 and +0.35 → mid)
    assert.equal(result.emotionalAxisBands.valence, "mid");
    // main_relationship: arousal 0 (centered → mid)
    assert.equal(result.emotionalAxisBands.arousal, "mid");
    // main_relationship: restraint 0.7 (> 0.65 → high)
    assert.equal(result.emotionalAxisBands.restraint, "high");
    // Synthetic trace with baselines
    assert.equal(result.emotionalAxisLastTrace.tick, 0);
    assert.deepEqual(result.emotionalAxisLastTrace.couplingsFired, []);
    assert.deepEqual(result.emotionalAxisLastTrace.effectiveBaselines, {});
    // Empty history
    assert.deepEqual(result.emotionalAxisHistory, []);
  });

  it("main_married renders restraint as mid (baseline 0.55, below high threshold 0.65)", () => {
    const result = resolveEmotionalRenderInputs(null, BASE, BY_SCOPE, "main_married");
    assert.ok(result !== null);
    assert.equal(result.emotionalAxisBands.restraint, "mid", "0.55 is mid (< 0.65)");
    assert.equal(result.emotionalAxisBands.connection, "mid", "0.35 centered → mid (+0.35 not > 0.35, equals threshold, mid)");
  });

  it("returns persisted state when available", () => {
    const persistedRow = {
      localRelationshipDelta: {
        axis_state: {
          version: 1,
          tick: 5,
          axes: { connection: 0.3, valence: -0.1, arousal: 0.05, restraint: 0.6 },
          lastTrace: {
            tick: 5,
            axesBefore: { connection: 0.2, valence: 0, arousal: 0, restraint: 0.7 },
            axesAfter: { connection: 0.3, valence: -0.1, arousal: 0.05, restraint: 0.6 },
            couplingsFired: [],
            effectiveBaselines: {},
          },
          bands: { connection: "mid", valence: "mid", arousal: "mid", restraint: "high" },
          history: [{ tick: 4, axes: { connection: 0.2, valence: 0, arousal: 0, restraint: 0.7 } }],
        },
      },
    };
    const result = resolveEmotionalRenderInputs(persistedRow as any, BASE, BY_SCOPE, "main_relationship");
    assert.ok(result !== null);
    assert.equal(result.emotionalAxisBands.restraint, "high");
    assert.equal(result.emotionalAxisLastTrace.tick, 5);
    assert.equal(result.emotionalAxisHistory.length, 1);
  });

  it("F14: corrupt persisted axis_state returns null (skip render)", () => {
    // axis_state key exists but version is wrong → readAxisState returns null
    const corruptRow = {
      localRelationshipDelta: {
        axis_state: { version: 999, tick: 0 },
        other_data: "keep",
      },
    };
    const result = resolveEmotionalRenderInputs(corruptRow as any, BASE, BY_SCOPE, "main_relationship");
    assert.equal(result, null, "corrupt state → null, not baseline-render");
  });

  it("fresh main_pre_relationship renders connection as mid (baseline -0.10 > -0.35)", () => {
    const byScope: ScopeBaselineOverrides = {
      main_pre_relationship: { connection: -0.10, valence: -0.05, restraint: 0.85 },
    };
    const result = resolveEmotionalRenderInputs(null, BASE, byScope, "main_pre_relationship");
    assert.ok(result !== null);
    assert.equal(result.emotionalAxisBands.connection, "mid", "-0.10 > -0.35 → mid for centered axis");
    assert.equal(result.emotionalAxisBands.restraint, "high", "0.85 > 0.65 → high");
  });

  // ---------------------------------------------------------------------------
  // TG1 — Source tagging
  // ---------------------------------------------------------------------------

  it("TG1: source is scope_baseline_synthetic with tick 0 when no persisted state", () => {
    const result = resolveEmotionalRenderInputs(null, BASE, BY_SCOPE, "main_relationship");
    assert.ok(result !== null);
    assert.equal(result.source, "scope_baseline_synthetic");
    assert.equal(result.sourceTick, 0);
    assert.equal(result.scope, "main_relationship");
    assert.ok(result.resolvedBaselines.connection !== undefined);
    assert.ok(result.resolvedBaselines.restraint !== undefined);
  });

  it("TG1: source is persisted_axis_state with correct tick when persisted state exists", () => {
    const persistedRow = {
      localRelationshipDelta: {
        axis_state: {
          version: 1,
          tick: 7,
          axes: { connection: 0.3, valence: -0.1, arousal: 0.05, restraint: 0.6 },
          lastTrace: {
            tick: 7,
            axesBefore: { connection: 0.2, valence: 0, arousal: 0, restraint: 0.7 },
            axesAfter: { connection: 0.3, valence: -0.1, arousal: 0.05, restraint: 0.6 },
            couplingsFired: ["zr_c1"],
            effectiveBaselines: {},
          },
          bands: { connection: "mid", valence: "mid", arousal: "mid", restraint: "high" },
          history: [],
        },
      },
    };
    const result = resolveEmotionalRenderInputs(persistedRow as any, BASE, BY_SCOPE, "main_married");
    assert.ok(result !== null);
    assert.equal(result.source, "persisted_axis_state");
    assert.equal(result.sourceTick, 7);
    assert.equal(result.scope, "main_married");
    // resolvedBaselines should be from the scope config (main_married: restraint 0.55)
    assert.equal(result.resolvedBaselines.restraint, 0.55);
    assert.equal(result.resolvedBaselines.connection, 0.35);
  });

  it("TG1: corrupt persisted axis_state returns null (no source tagging)", () => {
    const corruptRow = {
      localRelationshipDelta: {
        axis_state: { version: 999, tick: 0 },
      },
    };
    const result = resolveEmotionalRenderInputs(corruptRow as any, BASE, BY_SCOPE, "main_relationship");
    assert.equal(result, null);
  });

  it("TG1: missing axes config returns null (no source tagging)", () => {
    const result = resolveEmotionalRenderInputs(null, undefined, undefined, "main");
    assert.equal(result, null);
  });

  it("TG1: resolvedBaselines for main_pre_relationship include scope overrides", () => {
    const byScope: ScopeBaselineOverrides = {
      main_pre_relationship: { connection: -0.10, valence: -0.05, restraint: 0.85 },
    };
    const result = resolveEmotionalRenderInputs(null, BASE, byScope, "main_pre_relationship");
    assert.ok(result !== null);
    assert.equal(result.resolvedBaselines.connection, -0.10);
    assert.equal(result.resolvedBaselines.valence, -0.05);
    assert.equal(result.resolvedBaselines.restraint, 0.85);
    assert.equal(result.resolvedBaselines.arousal, 0, "arousal not in scope overrides, falls back to base 0");
  });
});

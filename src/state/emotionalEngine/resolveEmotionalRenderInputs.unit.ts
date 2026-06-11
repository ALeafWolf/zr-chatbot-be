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
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { advanceCharacterState } from "./advanceCharacterState";
import { MAX_AXIS_DELTA_PER_UPDATE, EVENT_TO_DELTA_MAP } from "./constants";
import type { CharacterStateAxes, AxesConfig, EmotionalCoupling, AdvanceResult, TurnEvent } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ZUO_RAN_AXES: AxesConfig = {
  connection: { baseline: 0, driftRate: 0.1, min: -1, max: 1 },
  valence: { baseline: 0, driftRate: 0.1, min: -1, max: 1 },
  arousal: { baseline: 0, driftRate: 0.1, min: -1, max: 1 },
  restraint: { baseline: 0.7, driftRate: 0.1, min: -1, max: 1 },
};

const NO_COUPLINGS: EmotionalCoupling[] = [];

/** Convenience wrapper – defaults to ZUO_RAN_AXES, no couplings, tick=1. */
function advance(
  state: CharacterStateAxes,
  eventDeltas: Partial<CharacterStateAxes> = {},
  axesConfig: AxesConfig = ZUO_RAN_AXES,
  tick = 1,
): AdvanceResult {
  return advanceCharacterState(state, axesConfig, NO_COUPLINGS, eventDeltas, tick);
}

/** Assert that two numbers are approximately equal (within floating-point tolerance). */
function approx(actual: number, expected: number, msg?: string): void {
  const tol = 1e-10;
  if (Math.abs(actual - expected) > tol) {
    assert.equal(actual, expected, msg ?? `expected ${expected} ± ${tol}, got ${actual}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("advanceCharacterState — TG1 pure engine core", () => {

  // =======================================================================
  // Phase 1 — event delta application
  // =======================================================================

  describe("Phase 1 — event deltas", () => {

    it("applies delta and drift compounds correctly", () => {
      const state: CharacterStateAxes = { connection: 0.3, valence: 0.3, arousal: 0, restraint: 0.7 };
      const result = advance(state, { connection: 0.05, valence: -0.03 });
      // connection Phase1: 0.35 → Phase3 drift -0.1 = 0.25
      // valence   Phase1: 0.27 → Phase3 drift -0.1 = 0.17
      approx(result.next.connection, 0.25, "connection: 0.3 (+0.05) → 0.35 → drift -0.1 → 0.25");
      approx(result.next.valence, 0.17, "valence: 0.3 (-0.03) → 0.27 → drift -0.1 → 0.17");
    });

    it("delta changes result relative to drift-only baseline", () => {
      const state: CharacterStateAxes = { connection: 0.3, valence: 0, arousal: 0, restraint: 0.7 };
      const noDelta = advance(state, {});
      const withDelta = advance(state, { connection: 0.05 });
      approx(noDelta.next.connection, 0.2, "drift-only: 0.3 - 0.1 = 0.2");
      approx(withDelta.next.connection, 0.25, "with delta: (0.3+0.05) - 0.1 = 0.25");
      approx(
        withDelta.next.connection - noDelta.next.connection,
        0.05,
        "delta of 0.05 fully preserved in net result",
      );
    });

    it("clamps positive deltas exceeding MAX_AXIS_DELTA_PER_UPDATE", () => {
      const state: CharacterStateAxes = { connection: 0.3, arousal: 0.3, valence: 0, restraint: 0.7 };
      // delta 0.5 clamped to 0.1 → same result as delta exactly 0.1
      const clamped = advance(state, { connection: 0.5, arousal: -0.3 });
      const atLimit = advance(state, { connection: MAX_AXIS_DELTA_PER_UPDATE, arousal: -MAX_AXIS_DELTA_PER_UPDATE });
      // Clamped and at-limit values must be identical
      assert.equal(clamped.next.connection, atLimit.next.connection, "0.5 delta == 0.1 delta after clamp");
      assert.equal(clamped.next.arousal, atLimit.next.arousal, "-0.3 delta == -0.1 delta after clamp");
    });

    it("clamps negative deltas below -MAX_AXIS_DELTA_PER_UPDATE", () => {
      const state: CharacterStateAxes = { connection: 0, valence: 0.3, arousal: 0, restraint: 0.7 };
      const result = advance(state, { valence: -0.5 });
      // -0.5 clamped to -0.1 → Phase1: 0.2 → Phase3 drift toward 0: 0.2 - 0.1 = 0.1
      approx(result.next.valence, 0.1, "-0.5 clamped to -0.1 gives valence=0.1");
    });

    it("empty deltas produce pure drift", () => {
      const state: CharacterStateAxes = { connection: 0.3, valence: 0.1, arousal: -0.2, restraint: 0.6 };
      const result = advance(state, {});
      approx(result.next.connection, 0.2, "connection drifts down from 0.3 to 0.2");
      approx(result.next.valence, 0, "valence drifts down from 0.1 to 0");
      approx(result.next.arousal, -0.1, "arousal drifts up from -0.2 to -0.1");
      approx(result.next.restraint, 0.7, "restraint drifts up from 0.6 to 0.7");
    });
  });

  // =======================================================================
  // Phase 3 — drift toward baseline
  // =======================================================================

  describe("Phase 3 — drift toward baseline", () => {

    it("drifts from above-baseline toward baseline", () => {
      const state: CharacterStateAxes = { connection: 0.5, valence: 0, arousal: 0, restraint: 0.7 };
      const result = advance(state);
      approx(result.next.connection, 0.4, "connection drifts down by 0.1");
      assert.equal(result.next.restraint, 0.7, "restraint at baseline 0.7 — unchanged");
    });

    it("drifts from below-baseline toward baseline", () => {
      const state: CharacterStateAxes = { connection: -0.3, valence: -0.2, arousal: 0, restraint: 0 };
      const result = advance(state);
      approx(result.next.connection, -0.2, "connection drifts up to -0.2");
      approx(result.next.restraint, 0.1, "restraint drifts up to 0.1");
    });

    it("never overshoots baseline during drift", () => {
      const state: CharacterStateAxes = { connection: -0.02, valence: 0, arousal: 0, restraint: 0.65 };
      const result = advance(state);
      assert.equal(result.next.connection, 0, "connection lands exactly on baseline (no overshoot)");
      assert.equal(result.next.restraint, 0.7, "restraint lands exactly on baseline (no overshoot)");
    });

    it("converges to baseline over multiple ticks and never overshoots", () => {
      let state: CharacterStateAxes = { connection: 0.9, valence: -0.8, arousal: 0.5, restraint: -0.1 };
      for (let tick = 1; tick <= 20; tick++) {
        const result = advanceCharacterState(state, ZUO_RAN_AXES, NO_COUPLINGS, {}, tick);
        assert.ok(result.next.connection <= state.connection + 1e-12, `tick ${tick}: connection should not rise`);
        state = result.next;
      }
      assert.equal(state.connection, 0, "connection converges to baseline 0");
      assert.equal(state.valence, 0, "valence converges to baseline 0");
      assert.equal(state.arousal, 0, "arousal converges to baseline 0");
      assert.equal(state.restraint, 0.7, "restraint converges to baseline 0.7");
    });
  });

  // =======================================================================
  // Phase 4 — range clamp + trace
  // =======================================================================

  describe("Phase 4 — clamp and trace", () => {

    it("clamps axes to configured range", () => {
      const tightConfig: AxesConfig = {
        connection: { baseline: 0, driftRate: 0.1, min: -0.5, max: 0.5 },
        valence: { baseline: 0, driftRate: 0.1, min: -0.5, max: 0.5 },
        arousal: { baseline: 0, driftRate: 0.1, min: -0.5, max: 0.5 },
        restraint: { baseline: 0, driftRate: 0.1, min: 0, max: 0.5 },
      };
      // connection 0.6 after drift: 0.6 - 0.1 = 0.5 (at max, no clamp needed)
      // valence -0.6 after drift: -0.6 + 0.1 = -0.5 (at min)
      // restraint -0.1: drift toward 0: 0 (≥0 clamp)
      const state: CharacterStateAxes = { connection: 0.6, valence: -0.6, arousal: 0, restraint: -0.1 };
      const result = advance(state, {}, tightConfig);
      assert.equal(result.next.connection, 0.5, "connection clamped to max 0.5");
      assert.equal(result.next.valence, -0.5, "valence clamped to min -0.5");
      assert.equal(result.next.restraint, 0, "restraint clamped to min 0");
    });

    it("trace records axesBefore, axesAfter, tick, empty couplingsFired and effectiveBaselines", () => {
      const state: CharacterStateAxes = { connection: 0.2, valence: -0.1, arousal: 0.05, restraint: 0.6 };
      const result = advance(state, { valence: -0.05 }, ZUO_RAN_AXES, 5);

      assert.equal(result.trace.tick, 5, "trace tick matches input");
      assert.deepEqual(result.trace.axesBefore, state, "trace axesBefore matches input state");
      assert.deepEqual(result.trace.couplingsFired, [], "trace couplingsFired is empty (TG1)");
      assert.deepEqual(result.trace.effectiveBaselines, {}, "trace effectiveBaselines is empty (TG1)");
      assert.notDeepEqual(result.trace.axesAfter, state, "trace axesAfter differs from axesBefore");
    });

    it("trace axesAfter matches returned next state", () => {
      const state: CharacterStateAxes = { connection: 0.5, valence: -0.3, arousal: 0.1, restraint: 0.4 };
      const result = advance(state, { connection: 0.08, arousal: -0.04 }, ZUO_RAN_AXES, 3);
      assert.deepEqual(result.trace.axesAfter, result.next, "trace.axesAfter === returned next");
    });
  });

  // =======================================================================
  // TG8 — Event recording in trace
  // =======================================================================

  describe("TG8 — event recording in trace", () => {
    it("records event in trace when provided", () => {
      const state: CharacterStateAxes = { connection: 0.3, valence: 0, arousal: 0, restraint: 0.7 };
      const event: TurnEvent = {
        type: 'user_pursues_connection',
        intensity: 0.7,
        reason: 'User asked a personal question',
      };
      const result = advanceCharacterState(state, ZUO_RAN_AXES, NO_COUPLINGS, {}, 1, event);
      assert.ok(result.trace.event !== undefined, "trace.event should be defined");
      assert.equal(result.trace.event!.type, 'user_pursues_connection', "event type preserved");
      assert.equal(result.trace.event!.intensity, 0.7, "event intensity preserved");
      assert.equal(result.trace.event!.reason, 'User asked a personal question', "event reason preserved");
    });

    it("trace.event is undefined when no event provided", () => {
      const state: CharacterStateAxes = { connection: 0.3, valence: 0, arousal: 0, restraint: 0.7 };
      const result = advanceCharacterState(state, ZUO_RAN_AXES, NO_COUPLINGS, {}, 1);
      assert.equal(result.trace.event, undefined, "trace.event should be undefined");
    });

    it("event deltas from event-to-delta mapping produce correct Phase-1 changes", () => {
      // Verify the mapping table produces correct deltas for a known event.
      // The caller maps event → deltas via EVENT_TO_DELTA_MAP and clamps; we test
      // that advanceCharacterState applies those deltas correctly in Phase 1.
      const state: CharacterStateAxes = { connection: 0, valence: 0, arousal: 0, restraint: 0.7 };
      const event: TurnEvent = {
        type: 'intimate_moment',
        intensity: 1.0,
        reason: 'Shared a close moment',
      };
      const baseDeltas = EVENT_TO_DELTA_MAP.intimate_moment;
      // intimate_moment: connection +0.10, valence +0.08, arousal +0.04
      // At intensity 1.0, all within ±0.1 clamp range.
      const eventDeltas: Partial<CharacterStateAxes> = {};
      const axes: (keyof CharacterStateAxes)[] = ['connection', 'valence', 'arousal', 'restraint'];
      for (const axis of axes) {
        const base = baseDeltas[axis];
        if (base !== undefined) {
          eventDeltas[axis] = Math.min(MAX_AXIS_DELTA_PER_UPDATE, Math.max(-MAX_AXIS_DELTA_PER_UPDATE, base * event.intensity));
        }
      }
      const result = advanceCharacterState(state, ZUO_RAN_AXES, NO_COUPLINGS, eventDeltas, 1, event);
      // Phase 1: connection 0 → 0.10, valence 0 → 0.08, arousal 0 → 0.04
      // Phase 3 drift (at rate 0.1, capped by distance to baseline):
      //   connection 0.10 → baseline 0: drift 0.10 → 0
      //   valence 0.08 → baseline 0: drift 0.08 → 0
      //   arousal 0.04 → baseline 0: drift 0.04 → 0
      //   restraint 0.70 → baseline 0.7: unchanged
      approx(result.next.connection, 0, "connection: +0.10 then drift 0.10 → 0");
      approx(result.next.valence, 0, "valence: +0.08 then drift 0.08 → 0");
      approx(result.next.arousal, 0, "arousal: +0.04 then drift 0.04 → 0");
      approx(result.next.restraint, 0.7, "restraint unchanged at baseline");
    });
  });

  // =======================================================================
  // TG6 — Full coupling execution
  // =======================================================================

  describe("TG6 — coupling execution", () => {
    const C_ZR_C1: EmotionalCoupling = {
      id: "zr_c1", source: "arousal", target: "restraint",
      effect_type: "direct_delta", coefficient: 0.6, derived_from: "defense_mechanism",
    };
    const C_ZR_C2: EmotionalCoupling = {
      id: "zr_c2", source: "connection", target: "restraint",
      effect_type: "baseline_shift", coefficient: -0.4, derived_from: "transition_rule",
      condition: { axis: "valence", threshold: 0, comparison: "above" },
    };
    const C_ZR_C3: EmotionalCoupling = {
      id: "zr_c3", source: "valence", target: "restraint",
      effect_type: "direct_delta", coefficient: -0.5, derived_from: "core_fear",
      condition: { axis: "valence", threshold: -0.2, comparison: "below" },
    };

    // Test 1: user_pursued_question walkthrough (roadmap example — F23)
    it("user_pursued_question → effective restraint baseline 0.44, fired zr_c2", () => {
      // To get effectiveBaseline(restraint) = 0.44 = 0.7 + (-0.4 * connectionPostP1),
      // connectionPostP1 must be (0.7 - 0.44) / 0.4 = 0.65.
      // Start connection at 0.6, add delta +0.05 → Phase 1 produces exactly 0.65.
      const state: CharacterStateAxes = { connection: 0.6, valence: 0.3, arousal: 0, restraint: 0.62 };
      const result = advanceCharacterState(state, ZUO_RAN_AXES, [C_ZR_C1, C_ZR_C2, C_ZR_C3], { connection: 0.05 }, 1);

      // zr_c2 effective_baseline = 0.7 + (-0.4 * 0.65) = 0.7 - 0.26 = 0.44
      approx(result.trace.effectiveBaselines.restraint ?? 0, 0.44, "effectiveBaselines.restraint = 0.44");
      assert.ok(result.trace.couplingsFired.includes("zr_c2"), "zr_c2 fired");
      // Drift: 0.62 → toward 0.44 by min(0.1, 0.18) = 0.1 → 0.52
      approx(result.next.restraint, 0.52, "restraint = 0.62 - 0.1 drift = 0.52");
    });

    // Test 2: zr_c1 instant lock-up
    it("zr_c1: arousal increase → restraint direct_delta lock-up", () => {
      const state: CharacterStateAxes = { connection: 0, valence: 0, arousal: 0.5, restraint: 0.3 };
      const result = advanceCharacterState(state, ZUO_RAN_AXES, [C_ZR_C1], { arousal: 0.1 }, 1);
      // Phase 1: arousal 0.5 → 0.6 (delta +0.1)
      // Phase 2: zr_c1: sourceDelta = +0.1, targetDelta = 0.1 * 0.6 = 0.06
      // restraint gets +0.06 from coupling: 0.3 + 0.06 = 0.36
      // Phase 3: drift toward baseline 0.7: 0.36 + min(0.1, 0.34) = 0.46
      approx(result.next.restraint, 0.46, "restraint locked up by zr_c1");
      assert.ok(result.trace.couplingsFired.includes("zr_c1"), "zr_c1 fired");
    });

    // Test 3: zr_c3 rebound + zr_c2 snap-back (F23: must actually fire zr_c3)
    it("zr_c3 fires on negative valence delta; zr_c2 condition fails → snap-back", () => {
      // valence = -0.3 (< -0.2 → zr_c3 condition passes)
      // valence delta = -0.05 → Phase-1 sourceDelta = -0.05 → zr_c3 fires with delta = -0.05 * -0.5 = +0.025
      // zr_c2 condition (valence > 0) fails → no baseline_shift
      const state: CharacterStateAxes = { connection: 0.8, valence: -0.3, arousal: 0, restraint: 0.4 };
      const result = advanceCharacterState(state, ZUO_RAN_AXES, [C_ZR_C1, C_ZR_C2, C_ZR_C3], { valence: -0.05 }, 1);
      // Phase 1: valence -0.3 → -0.35 (delta -0.05)
      // Phase 2: zr_c3: sourceDelta = -0.05, targetDelta = -0.05 * -0.5 = +0.025
      //   restraint = 0.4 + 0.025 = 0.425
      //   No other direct_delta couplings fire (zr_c1: arousal unchanged)
      // Phase 3: zr_c2 condition fails (valence -0.35 ≤ 0) → no baseline_shift
      //   Effective baseline for restraint = 0.7 (base)
      //   Drift: 0.425 → toward 0.7 by min(0.1, 0.275) = 0.1 → 0.525
      approx(result.next.restraint, 0.525, "restraint = 0.4 + 0.025 (zr_c3) + 0.1 drift = 0.525");
      assert.ok(result.trace.couplingsFired.includes("zr_c3"), "zr_c3 fired in rebound");
      assert.ok(!result.trace.couplingsFired.includes("zr_c2"), "zr_c2 NOT fired (condition failed)");
    });

    // Test 4: Batch simultaneity (order independence)
    it("multiple direct_delta couplings are computed simultaneously", () => {
      // Two couplings targeting the same axis from different sources
      const cA: EmotionalCoupling = { id: "cA", source: "connection", target: "restraint", effect_type: "direct_delta", coefficient: 0.5, derived_from: "test" };
      const cB: EmotionalCoupling = { id: "cB", source: "valence", target: "restraint", effect_type: "direct_delta", coefficient: 0.3, derived_from: "test" };
      const state: CharacterStateAxes = { connection: 0.4, valence: 0.2, arousal: 0, restraint: 0.5 };
      // Phase 1: connection +0.1, valence +0.05
      const result = advanceCharacterState(state, ZUO_RAN_AXES, [cA, cB], { connection: 0.1, valence: 0.05 }, 1);
      // Phase 1 deltas: connection +0.1, valence +0.05
      // Phase 2: cA: restraint += 0.1 * 0.5 = 0.05; cB: restraint += 0.05 * 0.3 = 0.015
      // Total: restraint gets +0.065 (both computed from Phase 1 state simultaneously)
      // Phase 3: drift toward baseline 0.7: 0.5 + 0.065 = 0.565 → 0.565 + min(0.1, 0.135) = 0.665
      approx(result.next.restraint, 0.665, "restraint = 0.5 + 0.065 (both deltas from Phase 1) + 0.1 drift = 0.665");
      assert.ok(result.trace.couplingsFired.includes("cA"), "cA fired");
      assert.ok(result.trace.couplingsFired.includes("cB"), "cB fired");
    });

    // Test 5: Multiple baseline_shift summation + clamp
    it("multiple baseline_shift couplings sum and clamp to axis range", () => {
      const shiftA: EmotionalCoupling = { id: "shiftA", source: "connection", target: "restraint", effect_type: "baseline_shift", coefficient: -0.3, derived_from: "test" };
      const shiftB: EmotionalCoupling = { id: "shiftB", source: "valence", target: "restraint", effect_type: "baseline_shift", coefficient: -0.4, derived_from: "test" };
      const state: CharacterStateAxes = { connection: 0.8, valence: 0.5, arousal: 0, restraint: 0.5 };
      const result = advanceCharacterState(state, ZUO_RAN_AXES, [shiftA, shiftB], {}, 1);
      // Phase 3: effective_baseline(restraint) = 0.7 + (-0.3 * 0.8) + (-0.4 * 0.5)
      //   = 0.7 - 0.24 - 0.20 = 0.26
      // Drift: 0.5 → toward 0.26 → 0.5 - min(0.1, 0.24) = 0.4
      approx(result.next.restraint, 0.4, "restraint drifts toward summed effective baseline 0.26");
      approx(result.trace.effectiveBaselines.restraint ?? 0, 0.26, "effectiveBaselines.restraint = 0.26");
      assert.ok(result.trace.couplingsFired.includes("shiftA"), "shiftA fired");
      assert.ok(result.trace.couplingsFired.includes("shiftB"), "shiftB fired");
    });

    // Test 6: F22 mixed-sign baseline_shift — sum-then-clamp order independence
    it("F22: mixed-sign baseline_shift sums correctly regardless of clamping order", () => {
      // restraint base baseline 0.9, range [-1, 1]
      const tightConfig: AxesConfig = {
        connection: { baseline: 0, driftRate: 0.1, min: -1, max: 1 },
        valence: { baseline: 0, driftRate: 0.1, min: -1, max: 1 },
        arousal: { baseline: 0, driftRate: 0.1, min: -1, max: 1 },
        restraint: { baseline: 0.9, driftRate: 0.1, min: 0, max: 1 },
      };
      // Two shifts: +0.5 and -0.5. Sum = 0. Clamp(0.9 + 0) = 0.9.
      // Under per-coupling clamp, first shift would clamp at 1 then subtract 0.5 = 0.5 — wrong.
      const shiftUp: EmotionalCoupling = { id: "shiftUp", source: "connection", target: "restraint", effect_type: "baseline_shift", coefficient: 0.5, derived_from: "test" };
      const shiftDown: EmotionalCoupling = { id: "shiftDown", source: "valence", target: "restraint", effect_type: "baseline_shift", coefficient: -0.5, derived_from: "test" };
      const state: CharacterStateAxes = { connection: 1.0, valence: 1.0, arousal: 0, restraint: 0.5 };
      const result = advanceCharacterState(state, tightConfig, [shiftUp, shiftDown], {}, 1);
      // Sum-then-clamp: offset = 0.5*1 + (-0.5)*1 = 0, effective_baseline = 0.9 + 0 = 0.9 (equals base, so trace omits it)
      // Verify effective baseline by checking drift result: 0.5 → toward 0.9 → 0.5 + min(0.1, 0.4) = 0.6
      // (If per-coupling clamp had been used, the result would differ — this is the regression guard.)
      approx(result.next.restraint, 0.6, "restraint drifts toward correct effective baseline 0.9 — proves sum-then-clamp");
      // The effective baseline equals the base baseline (0.9), so it's not in the trace (only shifted baselines shown)
      assert.equal(result.trace.effectiveBaselines.restraint, undefined, "effectiveBaselines.restraint omitted when equal to base baseline");
      assert.ok(result.trace.couplingsFired.includes("shiftUp"), "shiftUp fired");
      assert.ok(result.trace.couplingsFired.includes("shiftDown"), "shiftDown fired");
    });
  });
});

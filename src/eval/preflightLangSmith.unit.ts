import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ---------------------------------------------------------------------------
// Import the real preflight helper — no module mocks needed since we control
// behavior entirely via env vars that readEmotionalAxisVariant and
// validateEmotionalAxisVariantGuard read from process.env.
// ---------------------------------------------------------------------------

import { preflightEmotionalAxisLangSmithRun } from "./preflightLangSmith";

describe("preflightEmotionalAxisLangSmithRun — F4", () => {
  it("does not validate gates when EVAL_SCENARIO_SET is not emotional_axis", () => {
    delete process.env.EVAL_SCENARIO_SET;
    delete process.env.EMOTIONAL_AXIS_VARIANT;
    delete process.env.EMOTIONAL_ENGINE_ENABLED;
    delete process.env.EMOTIONAL_RENDER_ENABLED;
    process.env.EVAL_SCENARIO_SET = "regression";
    // Gates are disabled — should not throw for non-emotional-axis runs
    assert.doesNotThrow(() => preflightEmotionalAxisLangSmithRun());
  });

  it("does not validate gates when EVAL_SCENARIO_SET is unset", () => {
    delete process.env.EVAL_SCENARIO_SET;
    delete process.env.EMOTIONAL_AXIS_VARIANT;
    delete process.env.EMOTIONAL_ENGINE_ENABLED;
    delete process.env.EMOTIONAL_RENDER_ENABLED;
    assert.doesNotThrow(() => preflightEmotionalAxisLangSmithRun());
  });

  it("passes for baseline_no_emotional_axis with gates disabled", () => {
    delete process.env.EVAL_SCENARIO_SET;
    delete process.env.EMOTIONAL_AXIS_VARIANT;
    delete process.env.EMOTIONAL_ENGINE_ENABLED;
    delete process.env.EMOTIONAL_RENDER_ENABLED;
    process.env.EVAL_SCENARIO_SET = "emotional_axis";
    process.env.EMOTIONAL_AXIS_VARIANT = "baseline_no_emotional_axis";
    assert.doesNotThrow(() => preflightEmotionalAxisLangSmithRun());
  });

  it("throws for axis_state_no_render when EMOTIONAL_ENGINE_ENABLED is off", () => {
    delete process.env.EVAL_SCENARIO_SET;
    delete process.env.EMOTIONAL_AXIS_VARIANT;
    delete process.env.EMOTIONAL_ENGINE_ENABLED;
    delete process.env.EMOTIONAL_RENDER_ENABLED;
    process.env.EVAL_SCENARIO_SET = "emotional_axis";
    process.env.EMOTIONAL_AXIS_VARIANT = "axis_state_no_render";

    assert.throws(
      () => preflightEmotionalAxisLangSmithRun(),
      /EMOTIONAL_ENGINE_ENABLED/,
    );
  });

  it("throws for full_axis_coupling_render when EMOTIONAL_ENGINE_ENABLED is off", () => {
    delete process.env.EVAL_SCENARIO_SET;
    delete process.env.EMOTIONAL_AXIS_VARIANT;
    delete process.env.EMOTIONAL_ENGINE_ENABLED;
    delete process.env.EMOTIONAL_RENDER_ENABLED;
    process.env.EVAL_SCENARIO_SET = "emotional_axis";
    process.env.EMOTIONAL_AXIS_VARIANT = "full_axis_coupling_render";

    // Engine check fires first since it's listed first in the guard
    assert.throws(
      () => preflightEmotionalAxisLangSmithRun(),
      /EMOTIONAL_ENGINE_ENABLED/,
    );
  });

  it("throws for full_axis_coupling_render when EMOTIONAL_RENDER_ENABLED is off but engine is on", () => {
    delete process.env.EVAL_SCENARIO_SET;
    delete process.env.EMOTIONAL_AXIS_VARIANT;
    delete process.env.EMOTIONAL_ENGINE_ENABLED;
    delete process.env.EMOTIONAL_RENDER_ENABLED;
    process.env.EVAL_SCENARIO_SET = "emotional_axis";
    process.env.EMOTIONAL_AXIS_VARIANT = "full_axis_coupling_render";
    process.env.EMOTIONAL_ENGINE_ENABLED = "1";

    assert.throws(
      () => preflightEmotionalAxisLangSmithRun(),
      /EMOTIONAL_RENDER_ENABLED/,
    );
  });

  it("passes for full_axis_coupling_render when both gates are on", () => {
    delete process.env.EVAL_SCENARIO_SET;
    delete process.env.EMOTIONAL_AXIS_VARIANT;
    delete process.env.EMOTIONAL_ENGINE_ENABLED;
    delete process.env.EMOTIONAL_RENDER_ENABLED;
    process.env.EVAL_SCENARIO_SET = "emotional_axis";
    process.env.EMOTIONAL_AXIS_VARIANT = "full_axis_coupling_render";
    process.env.EMOTIONAL_ENGINE_ENABLED = "1";
    process.env.EMOTIONAL_RENDER_ENABLED = "1";

    assert.doesNotThrow(() => preflightEmotionalAxisLangSmithRun());
  });
});

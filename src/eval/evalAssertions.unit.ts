import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRerankAssertionContext, checkAssertion } from "./evalAssertions";
import type { EmotionalAxisEvalSnapshot } from "./evalSnapshots";

/** Helper to build a minimal emotional-axis snapshot for assertion tests. */
function makeEmotionalAxis(overrides?: Partial<EmotionalAxisEvalSnapshot>): EmotionalAxisEvalSnapshot {
  return {
    axesBefore: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 },
    eventDeltas: {},
    couplingsFired: [],
    effectiveBaselines: {},
    axesAfter: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 },
    bandsAfter: { connection: "mid", valence: "mid", arousal: "mid", restraint: "high" },
    tick: 1,
    scope: "main_relationship",
    resolvedBaselines: { connection: 0.15, valence: 0.05, arousal: 0, restraint: 0.7 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TG3 — Emotional-axis assertion types
// ---------------------------------------------------------------------------

describe("TG3 — emotional-axis assertion types", () => {
  const baseSnapshot = makeEmotionalAxis({
    event: { type: "user_challenges", intensity: 0.8, reason: "test" },
    eventDeltas: { arousal: 0.06, valence: -0.04 },
    couplingsFired: ["zr_c1"],
    effectiveBaselines: { restraint: 0.44 },
    conditionTransitions: [{ id: "zr_c2", from: true, to: false }],
    axesAfter: { connection: 0, valence: -0.04, arousal: 0.06, restraint: 0.736 },
    bandsAfter: { connection: "mid", valence: "mid", arousal: "mid", restraint: "high" },
    tick: 2,
    scope: "main_relationship",
    resolvedBaselines: { connection: 0.15, valence: 0.05, arousal: 0, restraint: 0.7 },
    render: {
      source: "persisted_axis_state",
      sourceTick: 2,
      bands: { connection: "mid", valence: "mid", arousal: "mid", restraint: "high" },
      renderRuleIds: ["R3", "R1"],
      renderBlock: "[当前状态下的行为基调]\n当前状态：克制：偏高｜亲近：中｜情绪：中｜唤起：中",
      tier: "C",
      resolvedBaselines: { connection: 0.15, valence: 0.05, arousal: 0, restraint: 0.7 },
    },
  });

  it("turn_event_type: passes when event matches", () => {
    const r = checkAssertion({ type: "turn_event_type", value: "user_challenges", description: "event check" }, "", undefined, { emotionalAxis: baseSnapshot });
    assert.equal(r.pass, true, "event type matches");
  });

  it("turn_event_type: fails when event mismatches", () => {
    const r = checkAssertion({ type: "turn_event_type", value: "intimate_moment", description: "event check" }, "", undefined, { emotionalAxis: baseSnapshot });
    assert.equal(r.pass, false, "event type mismatch");
  });

  it("axis_delta_sign: passes when sign matches", () => {
    const r = checkAssertion({ type: "axis_delta_sign", field: "arousal", value: "+", description: "delta sign" }, "", undefined, { emotionalAxis: baseSnapshot });
    assert.equal(r.pass, true, "arousal delta +");
  });

  it("axis_delta_sign: fails when sign mismatches", () => {
    const r = checkAssertion({ type: "axis_delta_sign", field: "arousal", value: "-", description: "delta sign" }, "", undefined, { emotionalAxis: baseSnapshot });
    assert.equal(r.pass, false, "arousal delta not -");
  });

  it("axis_after_between: passes when value in range", () => {
    const r = checkAssertion({ type: "axis_after_between", field: "restraint", value: "0.7,0.8", description: "range" }, "", undefined, { emotionalAxis: baseSnapshot });
    assert.equal(r.pass, true, "restraint 0.736 in [0.7,0.8]");
  });

  it("axis_after_between: fails when value out of range", () => {
    const r = checkAssertion({ type: "axis_after_between", field: "restraint", value: "0,0.5", description: "range" }, "", undefined, { emotionalAxis: baseSnapshot });
    assert.equal(r.pass, false, "restraint 0.736 not in [0,0.5]");
  });

  it("axis_band_equals: passes when band matches", () => {
    const r = checkAssertion({ type: "axis_band_equals", field: "restraint", value: "high", description: "band" }, "", undefined, { emotionalAxis: baseSnapshot });
    assert.equal(r.pass, true, "restraint high");
  });

  it("axis_band_equals: fails when band mismatches", () => {
    const r = checkAssertion({ type: "axis_band_equals", field: "restraint", value: "low", description: "band" }, "", undefined, { emotionalAxis: baseSnapshot });
    assert.equal(r.pass, false, "restraint not low");
  });

  it("couplings_fired_contains: passes when all expected couplings fired", () => {
    const r = checkAssertion({ type: "couplings_fired_contains", values: ["zr_c1"], description: "coupling" }, "", undefined, { emotionalAxis: baseSnapshot });
    assert.equal(r.pass, true, "zr_c1 fired");
  });

  it("couplings_fired_contains: fails when coupling missing", () => {
    const r = checkAssertion({ type: "couplings_fired_contains", values: ["zr_c3"], description: "coupling" }, "", undefined, { emotionalAxis: baseSnapshot });
    assert.equal(r.pass, false, "zr_c3 not fired");
  });

  it("couplings_fired_not_contains: passes when forbidden coupling absent", () => {
    const r = checkAssertion({ type: "couplings_fired_not_contains", values: ["zr_c3"], description: "no coupling" }, "", undefined, { emotionalAxis: baseSnapshot });
    assert.equal(r.pass, true, "zr_c3 not fired");
  });

  it("effective_baseline_shifted: detects shifted baseline", () => {
    const r = checkAssertion({ type: "effective_baseline_shifted", field: "restraint", value: "-", description: "baseline shift" }, "", undefined, { emotionalAxis: baseSnapshot });
    // restraint effectiveBaselines=0.44 vs resolvedBaselines=0.7 → shift = -0.26
    assert.equal(r.pass, true, "restraint shifted down");
  });

  it("condition_transition: passes when transition matches", () => {
    const r = checkAssertion({ type: "condition_transition", field: "zr_c2", expected: true, value: "false", description: "transition" }, "", undefined, { emotionalAxis: baseSnapshot });
    assert.equal(r.pass, true, "zr_c2 transition true→false");
  });

  it("render_rule_triggered: passes when expected rules present", () => {
    const r = checkAssertion({ type: "render_rule_triggered", values: ["R3", "R1"], description: "render rules" }, "", undefined, { emotionalAxis: baseSnapshot });
    assert.equal(r.pass, true, "R3 and R1 triggered");
  });

  it("render_rule_triggered: fails when rule missing", () => {
    const r = checkAssertion({ type: "render_rule_triggered", values: ["R7"], description: "render rules" }, "", undefined, { emotionalAxis: baseSnapshot });
    assert.equal(r.pass, false, "R7 not triggered");
  });

  it("render_block_contains: passes when block includes text", () => {
    const r = checkAssertion({ type: "render_block_contains", value: "克制：偏高", description: "block text" }, "", undefined, { emotionalAxis: baseSnapshot });
    assert.equal(r.pass, true, "band line present");
  });

  it("render_block_not_contains: passes when block excludes text", () => {
    const r = checkAssertion({ type: "render_block_not_contains", value: "R7 text", description: "block no text" }, "", undefined, { emotionalAxis: baseSnapshot });
    assert.equal(r.pass, true, "R7 not in block");
  });

  it("output_forbidden_patterns_absent: passes when patterns absent from reply", () => {
    const r = checkAssertion({ type: "output_forbidden_patterns_absent", values: ["bad_word"], description: "no bad words" }, "clean reply", undefined, { emotionalAxis: baseSnapshot });
    assert.equal(r.pass, true, "no forbidden patterns");
  });

  it("output_forbidden_patterns_absent: fails when pattern in reply", () => {
    const r = checkAssertion({ type: "output_forbidden_patterns_absent", values: ["bad_word"], description: "no bad words" }, "contains bad_word here", undefined, { emotionalAxis: baseSnapshot });
    assert.equal(r.pass, false, "forbidden pattern found");
  });

  it("missing emotionalAxis context returns pass false for axis assertions", () => {
    const r = checkAssertion({ type: "turn_event_type", value: "user_challenges", description: "no ctx" }, "", undefined, {});
    assert.equal(r.pass, false, "no emotionalAxis → fail");
  });

  // -------------------------------------------------------------------
  // F2 — fail closed when snapshot data is absent
  // -------------------------------------------------------------------

  it("F2: axis_delta_sign fails closed when eventDeltas absent", () => {
    const r = checkAssertion({ type: "axis_delta_sign", field: "arousal", value: "0", description: "no deltas" }, "", undefined, { emotionalAxis: makeEmotionalAxis({ eventDeltas: undefined }) });
    assert.equal(r.pass, false, "fails when eventDeltas absent");
  });

  it("F2: axis_after_between fails closed when axesAfter absent", () => {
    const r = checkAssertion({ type: "axis_after_between", field: "restraint", value: "0,1", description: "no axesAfter" }, "", undefined, { emotionalAxis: makeEmotionalAxis({ axesAfter: undefined }) });
    assert.equal(r.pass, false, "fails when axesAfter absent");
  });

  it("F2: axis_band_equals fails closed when bandsAfter absent", () => {
    const r = checkAssertion({ type: "axis_band_equals", field: "restraint", value: "high", description: "no bands" }, "", undefined, { emotionalAxis: makeEmotionalAxis({ bandsAfter: undefined }) });
    assert.equal(r.pass, false, "fails when bandsAfter absent");
  });

  it("F2: couplings_fired_not_contains fails closed when couplingsFired absent", () => {
    const r = checkAssertion({ type: "couplings_fired_not_contains", values: ["zr_c1"], description: "no couplings" }, "", undefined, { emotionalAxis: makeEmotionalAxis({ couplingsFired: undefined }) });
    assert.equal(r.pass, false, "fails when couplingsFired absent");
  });

  it("F2: condition_transition fails closed when conditionTransitions absent", () => {
    const r = checkAssertion({ type: "condition_transition", field: "zr_c2", expected: true, value: "false", description: "no transitions" }, "", undefined, { emotionalAxis: makeEmotionalAxis({ conditionTransitions: undefined }) });
    assert.equal(r.pass, false, "fails when conditionTransitions absent");
  });

  it("F2: render_block_contains fails closed when render snapshot absent", () => {
    const r = checkAssertion({ type: "render_block_contains", value: "test", description: "no render" }, "", undefined, { emotionalAxis: makeEmotionalAxis({ render: undefined }) });
    assert.equal(r.pass, false, "fails when render absent");
  });

  it("F2: effective_baseline_shifted fails closed when effectiveBaselines absent", () => {
    const r = checkAssertion({ type: "effective_baseline_shifted", field: "restraint", value: "-", description: "no baselines" }, "", undefined, { emotionalAxis: makeEmotionalAxis({ effectiveBaselines: undefined }) });
    assert.equal(r.pass, false, "fails when effectiveBaselines absent");
  });

  it("F2: render_rule_triggered fails closed when render snapshot absent", () => {
    const r = checkAssertion({ type: "render_rule_triggered", values: ["R1"], description: "no render" }, "", undefined, { emotionalAxis: makeEmotionalAxis({ render: undefined }) });
    assert.equal(r.pass, false, "fails when render absent");
  });

  // -------------------------------------------------------------------
  // F3 — output_forbidden_patterns_absent uses regex with literal fallback
  // -------------------------------------------------------------------

  it("F3: output_forbidden_patterns_absent matches regex pattern", () => {
    const r = checkAssertion({ type: "output_forbidden_patterns_absent", values: ["\\d{3}-\\d{4}"], description: "phone pattern" }, "call 555-1234", undefined, { emotionalAxis: baseSnapshot });
    assert.equal(r.pass, false, "fails when regex pattern matches");
  });

  it("F3: output_forbidden_patterns_absent literal fallback works", () => {
    const r = checkAssertion({ type: "output_forbidden_patterns_absent", values: ["literal_bad"], description: "literal" }, "contains literal_bad", undefined, { emotionalAxis: baseSnapshot });
    assert.equal(r.pass, false, "fails when literal substring matches");
  });

  // -------------------------------------------------------------------
  // F1 — LangSmith agent_turn context merges emotionalAxis + rerank
  // -------------------------------------------------------------------

  it("F1: agent_turn context with emotionalAxis passes render assertion", () => {
    // Simulates the LangSmith assertionsEvaluator for agent_turn rows:
    // the context is built from both rerank ctx (if any) and emotionalAxis.
    const ctx = {
      emotionalAxis: baseSnapshot,
    };
    const r = checkAssertion({ type: "render_rule_triggered", values: ["R3"], description: "render rule" }, "", undefined, ctx);
    assert.equal(r.pass, true, "render assertion passes with emotionalAxis in context");
  });

  it("F1: agent_turn context with emotionalAxis passes event assertion", () => {
    const ctx = {
      emotionalAxis: baseSnapshot,
    };
    const r = checkAssertion({ type: "turn_event_type", value: "user_challenges", description: "event" }, "", undefined, ctx);
    assert.equal(r.pass, true, "event assertion passes with emotionalAxis in context");
  });
});

describe("buildRerankAssertionContext", () => {
  it("returns undefined for null/undefined rerank, maps selectedIds/sources/finalContextMode/fallbackUsed, handles empty/omitted", () => {
    assert.equal(buildRerankAssertionContext(null), undefined, "null → undefined");
    assert.equal(buildRerankAssertionContext(undefined), undefined, "undefined → undefined");

    let r = buildRerankAssertionContext({ selected: [{ id: "mem_1", source: "interactive_memory" }, { id: "mem_2", source: "session_chunk" }], finalContextMode: "selected_memory", fallbackUsed: false } as any);
    assert.deepEqual(r?.rerank.selectedIds, ["mem_1", "mem_2"], "selectedIds");
    assert.deepEqual(r?.rerank.selectedSources, ["interactive_memory", "session_chunk"], "selectedSources");
    assert.equal(r?.rerank.finalContextMode, "selected_memory", "finalContextMode");
    assert.equal(r?.rerank.fallbackUsed, false, "fallbackUsed");

    r = buildRerankAssertionContext({ selected: [], finalContextMode: "recent_only", fallbackUsed: true } as any);
    assert.deepEqual(r?.rerank.selectedIds, [], "empty selectedIds");
    assert.deepEqual(r?.rerank.selectedSources, [], "empty selectedSources");
    assert.equal(r?.rerank.finalContextMode, "recent_only", "finalContextMode with empty");
    assert.equal(r?.rerank.fallbackUsed, true, "fallbackUsed with empty");

    r = buildRerankAssertionContext({ selected: [{ id: "mem_1", source: "interactive_memory" }] } as any);
    assert.deepEqual(r?.rerank.selectedIds, ["mem_1"], "selectedIds without extra fields");
    assert.equal(r?.rerank.finalContextMode, undefined, "finalContextMode omitted when absent");
    assert.equal(r?.rerank.fallbackUsed, undefined, "fallbackUsed omitted when absent");
  });
});

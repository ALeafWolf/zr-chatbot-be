import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EvaluationResult } from "langsmith/evaluation";
import { evaluateProbeGateThresholds, getExpectation, PROBE_GATE_EXPECTATIONS } from "./probeGateThresholds";
import type { ProbeGateExpectation } from "./probeGateThresholds";
import type { JudgeDimension } from "./internalLogicJudge";

function makeResults(overrides: { dimensionScores?: Partial<Record<JudgeDimension, number | null>>; composite?: number | null }): EvaluationResult[] {
  const dimScores = overrides.dimensionScores ?? {};
  const dims: JudgeDimension[] = ["traceability", "state_fit", "transition_friction", "style_stability", "canon_caution", "anti_self_analysis"];
  const r: EvaluationResult[] = dims.map((d) => ({ key: `judge_${d}`, score: d in dimScores ? (dimScores[d] ?? null) : 4, comment: "" }));
  r.push({ key: "judge_composite", score: overrides.composite !== undefined ? overrides.composite : 4.0, comment: "" });
  return r;
}

describe("PROBE_GATE_EXPECTATIONS", () => {
  it("has all 12 probes with valid ranges, deterministic lookup", () => {
    const ids = PROBE_GATE_EXPECTATIONS.map((e) => e.scenarioId).sort();
    assert.deepEqual(ids, ["probe_disclosure_pressure", "probe_false_premise_no_fact", "probe_false_premise_with_fact", "probe_forceful_format", "probe_post_argument", "probe_regret_apology", "probe_relationship_boundary", "probe_relaxed_morning", "probe_risk_control", "probe_social_pressure", "probe_warmth_concern", "probe_work_discussion"].sort(), "12 probes");
    for (const e of PROBE_GATE_EXPECTATIONS) { assert.ok(e.minComposite >= 1 && e.minComposite <= 5, `${e.scenarioId} minComposite`); }
    for (const e of PROBE_GATE_EXPECTATIONS) { for (const [, t] of Object.entries(e.dimensions)) assert.ok(t >= 1 && t <= 5, `${e.scenarioId} dimension`); }
    const validDims = ["traceability", "state_fit", "transition_friction", "style_stability", "canon_caution", "anti_self_analysis"];
    for (const e of PROBE_GATE_EXPECTATIONS) { for (const d of e.criticalDimensions ?? []) assert.ok(validDims.includes(d), `${e.scenarioId} critical "${d}"`); }
    const a = getExpectation("probe_relaxed_morning"); const b = getExpectation("probe_relaxed_morning");
    assert.equal(a.scenarioId, b.scenarioId); assert.equal(a.minComposite, b.minComposite);
  });
});

describe("getExpectation", () => {
  it("returns for known ID, throws for unknown", () => {
    const exp = getExpectation("probe_relaxed_morning");
    assert.equal(exp.scenarioId, "probe_relaxed_morning", "scenarioId");
    assert.ok(typeof exp.minComposite === "number", "minComposite is number");
    assert.ok(Object.keys(exp.dimensions).length > 0, "dimensions configured");
    assert.throws(() => getExpectation("nonexistent_scenario"), /Missing expectation/);
  });
});

describe("evaluateProbeGateThresholds", () => {
  it("passes when scores meet expectations, fails for below-threshold/null/missing/composite, handles custom overrides", () => {
    let r = evaluateProbeGateThresholds("probe_relaxed_morning", makeResults({}));
    assert.equal(r.hasFailed, false, "all pass"); assert.equal(r.failures.length, 0, "no failures");

    r = evaluateProbeGateThresholds("probe_false_premise_with_fact", makeResults({ dimensionScores: { canon_caution: 1 } }));
    assert.equal(r.hasFailed, true, "dimension below threshold");
    assert.ok(r.failures.some((f) => f.type === "dimension_below_threshold" && f.dimension === "canon_caution" && f.observed === 1 && f.threshold === 2), "canon_caution 1 < 2");

    r = evaluateProbeGateThresholds("probe_false_premise_with_fact", makeResults({ dimensionScores: { canon_caution: null } }));
    assert.equal(r.hasFailed, true, "null critical dimension");
    assert.ok(r.failures.some((f) => f.type === "critical_dimension_null" && f.dimension === "canon_caution"), "critical_dimension_null");

    r = evaluateProbeGateThresholds("probe_relaxed_morning", makeResults({ composite: 2.0 }));
    assert.equal(r.hasFailed, true, "composite below");
    assert.ok(r.failures.some((f) => f.type === "composite_below_threshold" && typeof f.observed === "number" && f.observed < 3.5), "composite < 3.5");

    r = evaluateProbeGateThresholds("nonexistent_probe", makeResults({}));
    assert.equal(r.hasFailed, true, "missing expectation");
    assert.ok(r.failures.some((f) => f.type === "missing_expectation"), "missing_expectation");

    r = evaluateProbeGateThresholds("probe_relaxed_morning", []);
    assert.equal(r.hasFailed, true, "empty results");
    assert.ok(r.failures.some((f) => f.type === "no_results"), "no_results");

    // Custom expectation override
    const custom: ProbeGateExpectation = { scenarioId: "custom", minComposite: 4.0, dimensions: { style_stability: 4 }, criticalDimensions: [] };
    r = evaluateProbeGateThresholds("custom", makeResults({ dimensionScores: { style_stability: 3 }, composite: 3.5 }), custom);
    assert.equal(r.hasFailed, true, "custom — fails");
    assert.ok(r.failures.some((f) => f.type === "dimension_below_threshold" && f.dimension === "style_stability" && f.observed === 3 && f.threshold === 4), "custom — dimension");
    assert.ok(r.failures.some((f) => f.type === "composite_below_threshold" && typeof f.observed === "number" && f.observed < 4), "custom — composite");

    // Multiple failures
    r = evaluateProbeGateThresholds("multi", makeResults({ dimensionScores: { state_fit: 1, anti_self_analysis: 2 }, composite: 2.0 }), { scenarioId: "multi", minComposite: 3.5, dimensions: { state_fit: 3, anti_self_analysis: 3 }, criticalDimensions: ["state_fit"] });
    assert.equal(r.hasFailed, true, "multiple failures"); assert.equal(r.failures.length, 3, "3 failures (2 dims + composite)");
  });

  it("handles null configured/non-configured dimensions and exact-threshold passes", () => {
    // Null configured non-critical → fails
    let r = evaluateProbeGateThresholds("probe_relaxed_morning", makeResults({ dimensionScores: { anti_self_analysis: null } }));
    assert.equal(r.hasFailed, true, "null configured non-critical");
    assert.ok(r.failures.some((f) => f.type === "dimension_below_threshold" && f.dimension === "anti_self_analysis" && f.observed === null && f.threshold === 3), "anti_self_analysis null");

    // All-null → fails for probe without criticalDimensions
    const allNull = makeResults({ dimensionScores: { traceability: null, state_fit: null, transition_friction: null, style_stability: null, canon_caution: null, anti_self_analysis: null }, composite: null });
    r = evaluateProbeGateThresholds("probe_warmth_concern", allNull);
    assert.equal(r.hasFailed, true, "all null — fails");
    assert.ok(r.failures.some((f) => f.type === "dimension_below_threshold" && f.dimension === "style_stability" && f.observed === null), "all null — style_stability");
    assert.ok(r.failures.some((f) => f.type === "composite_below_threshold" && f.observed === null), "all null — composite null");

    // Null composite → fails
    r = evaluateProbeGateThresholds("probe_relaxed_morning", makeResults({ composite: null }));
    assert.equal(r.hasFailed, true, "null composite");
    assert.ok(r.failures.some((f) => f.type === "composite_below_threshold" && f.observed === null && f.threshold === 3.5), "null composite — type/threshold");

    // Null non-configured dimension → ignored
    r = evaluateProbeGateThresholds("probe_work_discussion", makeResults({ dimensionScores: { traceability: null } }));
    assert.equal(r.hasFailed, false, "null non-configured → pass");

    // Exact threshold → pass
    r = evaluateProbeGateThresholds("probe_relaxed_morning", makeResults({ dimensionScores: { state_fit: 3 } }));
    assert.equal(r.hasFailed, false, "dimension at threshold → pass");
    r = evaluateProbeGateThresholds("probe_relaxed_morning", makeResults({ composite: 3.5 }));
    assert.equal(r.hasFailed, false, "composite at threshold → pass");

    // scenarioId propagated
    r = evaluateProbeGateThresholds("probe_post_argument", makeResults({}));
    assert.equal(r.scenarioId, "probe_post_argument", "scenarioId propagated");
  });
});

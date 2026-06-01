/**
 * Unit tests for probe-gate threshold evaluation logic (TG2).
 *
 * Tests are pure — no live LLM calls, no LangSmith credentials.
 * All scenarios use injected judge feedback results.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EvaluationResult } from "langsmith/evaluation";
import {
  evaluateProbeGateThresholds,
  getExpectation,
  PROBE_GATE_EXPECTATIONS,
} from "./probeGateThresholds";
import type { ProbeGateExpectation } from "./probeGateThresholds";
import type { JudgeDimension } from "./internalLogicJudge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a set of 7 EvaluationResults from partial scores. */
function makeResults(overrides: {
  dimensionScores?: Partial<Record<JudgeDimension, number | null>>;
  composite?: number | null;
}): EvaluationResult[] {
  const dimScores = overrides.dimensionScores ?? {};
  const dims: JudgeDimension[] = [
    "traceability",
    "state_fit",
    "transition_friction",
    "style_stability",
    "canon_caution",
    "anti_self_analysis",
  ];

  const results: EvaluationResult[] = dims.map((d) => {
    const score: number | null = d in dimScores ? (dimScores[d] ?? null) : 4;
    return { key: `judge_${d}`, score, comment: "" };
  });

  const composite: number | null =
    overrides.composite !== undefined ? overrides.composite : 4.0;
  results.push({
    key: "judge_composite",
    score: composite,
    comment: "",
  });

  return results;
}

// ---------------------------------------------------------------------------
// PROBE_GATE_EXPECTATIONS table integrity
// ---------------------------------------------------------------------------

describe("PROBE_GATE_EXPECTATIONS", () => {
  it("has entries for all 12 probes", () => {
    const expectedIds = [
      "probe_relaxed_morning",
      "probe_work_discussion",
      "probe_post_argument",
      "probe_disclosure_pressure",
      "probe_forceful_format",
      "probe_false_premise_with_fact",
      "probe_false_premise_no_fact",
      "probe_relationship_boundary",
      "probe_warmth_concern",
      "probe_risk_control",
      "probe_social_pressure",
      "probe_regret_apology",
    ];
    const actualIds = PROBE_GATE_EXPECTATIONS.map((e) => e.scenarioId).sort();
    assert.deepEqual(actualIds, expectedIds.slice().sort());
  });

  it("every entry has valid minComposite between 1 and 5", () => {
    for (const entry of PROBE_GATE_EXPECTATIONS) {
      assert.ok(
        entry.minComposite >= 1 && entry.minComposite <= 5,
        `${entry.scenarioId} minComposite ${entry.minComposite} out of range`,
      );
    }
  });

  it("every dimension threshold is between 1 and 5", () => {
    for (const entry of PROBE_GATE_EXPECTATIONS) {
      for (const [dim, threshold] of Object.entries(entry.dimensions)) {
        assert.ok(
          threshold >= 1 && threshold <= 5,
          `${entry.scenarioId} dimension ${dim} threshold ${threshold} out of range`,
        );
      }
    }
  });

  it("every criticalDimension is a valid JudgeDimension", () => {
    const validDims = [
      "traceability",
      "state_fit",
      "transition_friction",
      "style_stability",
      "canon_caution",
      "anti_self_analysis",
    ];
    for (const entry of PROBE_GATE_EXPECTATIONS) {
      for (const dim of entry.criticalDimensions ?? []) {
        assert.ok(
          validDims.includes(dim),
          `${entry.scenarioId} invalid criticalDimension "${dim}"`,
        );
      }
    }
  });

  it("expectations are deterministic (same ID always returns same entry)", () => {
    const p01a = getExpectation("probe_relaxed_morning");
    const p01b = getExpectation("probe_relaxed_morning");
    assert.equal(p01a.scenarioId, p01b.scenarioId);
    assert.equal(p01a.minComposite, p01b.minComposite);
  });
});

// ---------------------------------------------------------------------------
// getExpectation
// ---------------------------------------------------------------------------

describe("getExpectation", () => {
  it("returns expectation for a known scenario ID", () => {
    const exp = getExpectation("probe_relaxed_morning");
    assert.equal(exp.scenarioId, "probe_relaxed_morning");
    assert.ok(typeof exp.minComposite === "number");
    assert.ok(Object.keys(exp.dimensions).length > 0);
  });

  it("throws for an unknown scenario ID", () => {
    assert.throws(
      () => getExpectation("nonexistent_scenario"),
      /Missing expectation/,
    );
  });
});

// ---------------------------------------------------------------------------
// evaluateProbeGateThresholds
// ---------------------------------------------------------------------------

describe("evaluateProbeGateThresholds", () => {
  // --- Pass case ---
  it("returns hasFailed=false when all scores meet expectations", () => {
    const results = makeResults({});
    const result = evaluateProbeGateThresholds(
      "probe_relaxed_morning",
      results,
    );
    assert.equal(result.hasFailed, false);
    assert.equal(result.failures.length, 0);
  });

  // --- Dimension below threshold ---
  it("detects a dimension score below threshold", () => {
    const results = makeResults({
      dimensionScores: { canon_caution: 1 },
    });
    // probe_false_premise_with_fact has canon_caution threshold of 2
    const result = evaluateProbeGateThresholds(
      "probe_false_premise_with_fact",
      results,
    );
    assert.equal(result.hasFailed, true);
    assert.ok(
      result.failures.some(
        (f) =>
          f.type === "dimension_below_threshold" &&
          f.dimension === "canon_caution" &&
          f.observed === 1 &&
          f.threshold === 2,
      ),
    );
  });

  // --- Null critical dimension ---
  it("detects a null score for a critical dimension", () => {
    const results = makeResults({
      dimensionScores: { canon_caution: null },
    });
    const result = evaluateProbeGateThresholds(
      "probe_false_premise_with_fact",
      results,
    );
    // canon_caution is critical for this probe
    assert.equal(result.hasFailed, true);
    assert.ok(
      result.failures.some(
        (f) => f.type === "critical_dimension_null" && f.dimension === "canon_caution",
      ),
    );
  });

  // --- Composite below threshold ---
  it("detects composite score below minComposite", () => {
    const results = makeResults({ composite: 2.0 });
    const result = evaluateProbeGateThresholds(
      "probe_relaxed_morning",
      results,
    );
    // probe_relaxed_morning has minComposite of 3.5
    assert.equal(result.hasFailed, true);
    assert.ok(
      result.failures.some(
        (f) =>
          f.type === "composite_below_threshold" &&
          typeof f.observed === "number" &&
          f.observed < 3.5,
      ),
    );
  });

  // --- Missing expectation ---
  it("returns hasFailed=true for unknown scenario ID (missing expectation)", () => {
    const results = makeResults({});
    const result = evaluateProbeGateThresholds("nonexistent_probe", results);
    assert.equal(result.hasFailed, true);
    assert.ok(
      result.failures.some((f) => f.type === "missing_expectation"),
    );
  });

  // --- Empty results ---
  it("returns hasFailed=true when results array is empty", () => {
    const result = evaluateProbeGateThresholds("probe_relaxed_morning", []);
    assert.equal(result.hasFailed, true);
    assert.ok(result.failures.some((f) => f.type === "no_results"));
  });

  // --- Custom expectation override ---
  it("accepts an explicit expectation override", () => {
    const customExp: ProbeGateExpectation = {
      scenarioId: "custom_test",
      minComposite: 4.0,
      dimensions: { style_stability: 4 },
      criticalDimensions: [],
    };
    const results = makeResults({
      dimensionScores: { style_stability: 3 },
      composite: 3.5,
    });
    const result = evaluateProbeGateThresholds("custom_test", results, customExp);
    assert.equal(result.hasFailed, true);
    assert.ok(
      result.failures.some(
        (f) =>
          f.type === "dimension_below_threshold" &&
          f.dimension === "style_stability" &&
          f.observed === 3 &&
          f.threshold === 4,
      ),
    );
    assert.ok(
      result.failures.some(
        (f) =>
          f.type === "composite_below_threshold" &&
          typeof f.observed === "number" &&
          f.observed < 4,
      ),
    );
  });

  // --- Multiple failures ---
  it("reports multiple failures simultaneously", () => {
    const results = makeResults({
      dimensionScores: { state_fit: 1, anti_self_analysis: 2 },
      composite: 2.0,
    });
    const customExp: ProbeGateExpectation = {
      scenarioId: "multi_fail",
      minComposite: 3.5,
      dimensions: { state_fit: 3, anti_self_analysis: 3 },
      criticalDimensions: ["state_fit"], // NOT null, so critical is fine
    };
    const result = evaluateProbeGateThresholds("multi_fail", results, customExp);
    assert.equal(result.hasFailed, true);
    // Should have 3 failures: state_fit below, anti_self_analysis below, composite below
    assert.equal(result.failures.length, 3);
  });

  // --- Null configured dimension fails (even if non-critical) ---
  it("fails when a configured non-critical dimension has null score", () => {
    // probe_relaxed_morning: dimensions { state_fit:3, style_stability:3, anti_self_analysis:3 }
    // critical: ["state_fit"] → anti_self_analysis is configured but NOT critical
    const results = makeResults({
      dimensionScores: { anti_self_analysis: null },
    });
    const result = evaluateProbeGateThresholds("probe_relaxed_morning", results);
    assert.equal(result.hasFailed, true);
    assert.ok(
      result.failures.some(
        (f) =>
          f.type === "dimension_below_threshold" &&
          f.dimension === "anti_self_analysis" &&
          f.observed === null &&
          f.threshold === 3,
      ),
      "Should fail because configured dimension anti_self_analysis is null",
    );
  });

  // --- All-null results fail for probe without criticalDimensions ---
  it("fails when all judge results are null for a probe without criticalDimensions", () => {
    // probe_warmth_concern has NO criticalDimensions, only configured dimensions
    const results = makeResults({
      dimensionScores: {
        traceability: null,
        state_fit: null,
        transition_friction: null,
        style_stability: null,
        canon_caution: null,
        anti_self_analysis: null,
      },
      composite: null,
    });
    const result = evaluateProbeGateThresholds("probe_warmth_concern", results);
    assert.equal(result.hasFailed, true);
    // Should fail for each configured dimension (style_stability, anti_self_analysis)
    // AND for null composite
    assert.ok(
      result.failures.some(
        (f) => f.type === "dimension_below_threshold" && f.dimension === "style_stability" && f.observed === null,
      ),
    );
    assert.ok(
      result.failures.some(
        (f) => f.type === "dimension_below_threshold" && f.dimension === "anti_self_analysis" && f.observed === null,
      ),
    );
    assert.ok(
      result.failures.some(
        (f) => f.type === "composite_below_threshold" && f.observed === null,
      ),
    );
  });

  // --- Null composite fails ---
  it("fails when composite score is null", () => {
    const results = makeResults({ composite: null });
    const result = evaluateProbeGateThresholds("probe_relaxed_morning", results);
    assert.equal(result.hasFailed, true);
    assert.ok(
      result.failures.some(
        (f) =>
          f.type === "composite_below_threshold" &&
          f.observed === null &&
          f.threshold === 3.5,
      ),
    );
  });

  // --- Null non-configured dimension is ignored ---
  it("does not fail for a null score on a non-configured dimension", () => {
    // probe_work_discussion configures only style_stability and anti_self_analysis
    // traceability is NOT configured; null traceability should be ignored
    const results = makeResults({
      dimensionScores: { traceability: null },
    });
    const result = evaluateProbeGateThresholds("probe_work_discussion", results);
    assert.equal(result.hasFailed, false);
  });

  // --- Score exactly at threshold passes ---
  it("passes when dimension score equals threshold exactly", () => {
    const results = makeResults({
      dimensionScores: { state_fit: 3 },
    });
    // probe_relaxed_morning has state_fit threshold of 3
    const result = evaluateProbeGateThresholds(
      "probe_relaxed_morning",
      results,
    );
    assert.equal(result.hasFailed, false);
  });

  // --- Composite exactly at minComposite passes ---
  it("passes when composite score equals minComposite exactly", () => {
    const results = makeResults({ composite: 3.5 });
    const result = evaluateProbeGateThresholds(
      "probe_relaxed_morning",
      results,
    );
    assert.equal(result.hasFailed, false);
  });

  // --- ScenarioId is propagated in the result ---
  it("propagates scenarioId in the result", () => {
    const results = makeResults({});
    const result = evaluateProbeGateThresholds(
      "probe_post_argument",
      results,
    );
    assert.equal(result.scenarioId, "probe_post_argument");
  });
});

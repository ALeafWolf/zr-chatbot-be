/**
 * Probe-gate expectations and threshold evaluation logic (TG2).
 *
 * Defines the active baseline expectations for all 12 internal-logic probes.
 * Each expectation specifies the minimum composite score, per-dimension
 * thresholds for dimensions meaningful to that probe, and critical dimensions
 * where a null score must fail the gate.
 *
 * This module is pure — no LangSmith wiring, no live LLM calls. The threshold
 * evaluator compares judge feedback results against expectations and returns
 * a structured pass/fail result.
 */
import type { EvaluationResult } from "langsmith/evaluation";
import { JUDGE_DIMENSIONS, type JudgeDimension } from "./internalLogicJudge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProbeGateExpectation {
  scenarioId: string;
  /** Minimum composite score (mean of 6 dimensions, 1–5). */
  minComposite: number;
  /**
   * Per-dimension minimum thresholds. Only dimensions meaningful to this
   * probe are listed; unlisted dimensions are not checked.
   */
  dimensions: Partial<Record<JudgeDimension, number>>;
  /**
   * Dimensions where a null score (judge failure) must fail the gate.
   * For example, `canon_caution` on a false-premise probe.
   */
  criticalDimensions?: JudgeDimension[];
  /** Short human-readable note explaining the probe's target. */
  notes?: string;
}

export interface ThresholdFailure {
  scenarioId: string;
  failures: Array<{
    type:
      | "dimension_below_threshold"
      | "critical_dimension_null"
      | "composite_below_threshold"
      | "missing_expectation"
      | "no_results";
    dimension?: JudgeDimension;
    observed: number | null;
    threshold: number;
    comment?: string;
  }>;
  /** True if any failure exists. */
  hasFailed: boolean;
}

// ---------------------------------------------------------------------------
// Expectations table — keyed by probe scenario ID
// ---------------------------------------------------------------------------

/**
 * Active baseline expectations for the 12 internal-logic probes.
 *
 * Thresholds are intentionally conservative to avoid flakiness from
 * LLM-as-judge variance. They are anchored to each probe's target behavior.
 */
export const PROBE_GATE_EXPECTATIONS: ProbeGateExpectation[] = [
  // P01 — Relaxed morning
  {
    scenarioId: "probe_relaxed_morning",
    minComposite: 3.5,
    dimensions: {
      state_fit: 3,
      style_stability: 3,
      anti_self_analysis: 3,
    },
    criticalDimensions: ["state_fit"],
    notes: "Relaxed domestic scene — reply should match calm mood, avoid analysis",
  },

  // P02 — Work discussion
  {
    scenarioId: "probe_work_discussion",
    minComposite: 3.5,
    dimensions: {
      style_stability: 3,
      anti_self_analysis: 3,
    },
    criticalDimensions: ["style_stability"],
    notes: "Professional case discussion — reply should be work-appropriate, not personal",
  },

  // P03 — Post-argument tension
  {
    scenarioId: "probe_post_argument",
    minComposite: 3.0,
    dimensions: {
      transition_friction: 3,
      state_fit: 3,
      anti_self_analysis: 3,
    },
    criticalDimensions: ["transition_friction"],
    notes: "Post-argument — should show intermediate steps, not emotional dumping",
  },

  // P04 — Disclosure pressure
  {
    scenarioId: "probe_disclosure_pressure",
    minComposite: 3.0,
    dimensions: {
      transition_friction: 3,
      anti_self_analysis: 3,
    },
    criticalDimensions: ["anti_self_analysis"],
    notes: "Emotional pressure — gradual loosening, no direct self-analysis",
  },

  // P05 — Forceful format
  {
    scenarioId: "probe_forceful_format",
    minComposite: 3.0,
    dimensions: {
      style_stability: 3,
      anti_self_analysis: 3,
    },
    criticalDimensions: ["style_stability"],
    notes: "Forceful analytical format — must resist list-style reply",
  },

  // P06 — False premise with fact
  {
    scenarioId: "probe_false_premise_with_fact",
    minComposite: 2.5,
    dimensions: {
      canon_caution: 2,
      transition_friction: 2,
    },
    criticalDimensions: ["canon_caution"],
    notes: "Known-weak probe — false premise with canon fact; should correct, not romanticize",
  },

  // P07 — False premise without fact
  {
    scenarioId: "probe_false_premise_no_fact",
    minComposite: 2.5,
    dimensions: {
      canon_caution: 2,
    },
    criticalDimensions: ["canon_caution"],
    notes: "Known-weak probe — false premise without canon fact; should not confirm",
  },

  // P08 — Relationship boundary
  {
    scenarioId: "probe_relationship_boundary",
    minComposite: 3.0,
    dimensions: {
      state_fit: 3,
      traceability: 3,
      anti_self_analysis: 3,
    },
    criticalDimensions: ["state_fit", "traceability"],
    notes: "Pre-relationship boundary — maintain professional distance, no inner thoughts",
  },

  // P09 — Warmth and concern
  {
    scenarioId: "probe_warmth_concern",
    minComposite: 3.5,
    dimensions: {
      style_stability: 3,
      anti_self_analysis: 3,
    },
    notes: "Show care through action/subtlety, not direct emotional declaration",
  },

  // P10 — Risk control
  {
    scenarioId: "probe_risk_control",
    minComposite: 3.0,
    dimensions: {
      anti_self_analysis: 3,
      transition_friction: 3,
    },
    criticalDimensions: ["anti_self_analysis"],
    notes: "Action-oriented concern — no verbal emotional dumping",
  },

  // P11 — Social pressure
  {
    scenarioId: "probe_social_pressure",
    minComposite: 3.0,
    dimensions: {
      style_stability: 3,
      transition_friction: 3,
      anti_self_analysis: 3,
    },
    notes: "Social event — composed, slight回避 but not flustered",
  },

  // P12 — Regret and apology
  {
    scenarioId: "probe_regret_apology",
    minComposite: 3.0,
    dimensions: {
      transition_friction: 3,
      anti_self_analysis: 3,
    },
    criticalDimensions: ["anti_self_analysis"],
    notes: "Apology — acknowledge mistake without excessive self-criticism",
  },
];

// ---------------------------------------------------------------------------
// Lookup helper
// ---------------------------------------------------------------------------

/**
 * Look up the expectation for a given scenario ID.
 * Throws if not found — missing expectations are a configuration error.
 */
export function getExpectation(scenarioId: string): ProbeGateExpectation {
  const found = PROBE_GATE_EXPECTATIONS.find(
    (e) => e.scenarioId === scenarioId,
  );
  if (!found) {
    throw new Error(
      `[probeGateThresholds] Missing expectation for scenario "${scenarioId}". ` +
        "Add an entry to PROBE_GATE_EXPECTATIONS.",
    );
  }
  return found;
}

// ---------------------------------------------------------------------------
// Threshold evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate judge feedback results against the expectation for a scenario.
 *
 * @param scenarioId - The probe scenario ID.
 * @param results - The 7 judge feedback EvaluationResults (6 dimensions + composite).
 * @param expectation - Optional override expectation. If omitted, looked up by scenarioId.
 * @returns A ThresholdFailure describing all detected failures.
 */
export function evaluateProbeGateThresholds(
  scenarioId: string,
  results: EvaluationResult[],
  expectation?: ProbeGateExpectation,
): ThresholdFailure {
  // Resolve expectation
  let exp: ProbeGateExpectation;
  try {
    exp = expectation ?? getExpectation(scenarioId);
  } catch {
    return {
      scenarioId,
      failures: [{ type: "missing_expectation", observed: null, threshold: 0 }],
      hasFailed: true,
    };
  }

  const failures: ThresholdFailure["failures"] = [];

  if (!results || results.length === 0) {
    return {
      scenarioId,
      failures: [{ type: "no_results", observed: null, threshold: 0 }],
      hasFailed: true,
    };
  }

  // Build a map: key → numeric score or null
  const scoreMap = new Map<string, number | null>();
  for (const r of results) {
    const s = r.score;
    scoreMap.set(
      r.key,
      s == null || typeof s === "boolean" ? null : (s as number),
    );
  }

  // Check critical dimensions — a null score for a critical dimension is a failure
  for (const dim of exp.criticalDimensions ?? []) {
    const key = `judge_${dim}`;
    const score = scoreMap.get(key) ?? null;
    if (score === null) {
      failures.push({
        type: "critical_dimension_null",
        dimension: dim,
        observed: null,
        threshold: 0,
        comment: `Critical dimension "${dim}" has null score`,
      });
    }
  }

  // Check per-dimension thresholds
  for (const [dim, threshold] of Object.entries(exp.dimensions)) {
    const key = `judge_${dim}`;
    const score = scoreMap.get(key) ?? null;
    if (score === null) {
      // Null/missing score for a configured dimension → fail closed
      failures.push({
        type: "dimension_below_threshold",
        dimension: dim as JudgeDimension,
        observed: null,
        threshold,
        comment: `Dimension "${dim}" score is null, cannot satisfy threshold ${threshold}`,
      });
    } else if (score < threshold) {
      failures.push({
        type: "dimension_below_threshold",
        dimension: dim as JudgeDimension,
        observed: score,
        threshold,
        comment: `Dimension "${dim}" score ${score} below threshold ${threshold}`,
      });
    }
  }

  // Check composite score
  const compositeScore = scoreMap.get("judge_composite") ?? null;
  if (compositeScore === null) {
    // Null/missing composite → fail closed
    failures.push({
      type: "composite_below_threshold",
      observed: null,
      threshold: exp.minComposite,
      comment: `Composite score is null, cannot satisfy threshold ${exp.minComposite}`,
    });
  } else if (compositeScore < exp.minComposite) {
    failures.push({
      type: "composite_below_threshold",
      observed: compositeScore,
      threshold: exp.minComposite,
      comment: `Composite score ${compositeScore.toFixed(2)} below threshold ${exp.minComposite}`,
    });
  }

  return {
    scenarioId,
    failures,
    hasFailed: failures.length > 0,
  };
}

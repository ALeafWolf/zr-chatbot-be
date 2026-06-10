/**
 * Unit tests for the internal-logic probe gate runner (TG3).
 *
 * Tests the pure report builder and result logic only — no live agent
 * eval calls, no live LLM judge calls, no LangSmith credentials.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildProbeGateReport,
  type ProbeGateRunResult,
  type ProbeGateReport,
} from "./runInternalLogicProbeGate";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePassResult(overrides?: Partial<ProbeGateRunResult>): ProbeGateRunResult {
  return {
    scenarioId: "probe_test",
    description: "Test probe",
    agentSuccess: true,
    agentReply: "This is a test reply.",
    threshold: {
      scenarioId: "probe_test",
      failures: [],
      hasFailed: false,
    },
    passed: true,
    ...overrides,
  };
}

function makeFailResult(overrides?: Partial<ProbeGateRunResult>): ProbeGateRunResult {
  return {
    scenarioId: "probe_fail_test",
    description: "Failing test probe",
    agentSuccess: true,
    agentReply: "Poor reply.",
    threshold: {
      scenarioId: "probe_fail_test",
      failures: [
        {
          type: "dimension_below_threshold",
          dimension: "canon_caution",
          observed: 1,
          threshold: 2,
          comment: 'Dimension "canon_caution" score 1 below threshold 2',
        },
      ],
      hasFailed: true,
    },
    passed: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildProbeGateReport
// ---------------------------------------------------------------------------

describe("buildProbeGateReport", () => {
  it("includes the header", () => {
    const report: ProbeGateReport = {
      results: [],
      totalProbes: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
    };
    const text = buildProbeGateReport(report);
    assert.ok(text.includes("Internal-Logic Probe Gate Report"));
  });

  it("includes PASS for a passing probe", () => {
    const report: ProbeGateReport = {
      results: [makePassResult()],
      totalProbes: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
    };
    const text = buildProbeGateReport(report);
    assert.ok(text.includes("PASS"));
    assert.ok(text.includes("probe_test"));
    assert.ok(text.includes("reply_len="));
  });

  it("includes FAIL for a failing probe with failure details", () => {
    const report: ProbeGateReport = {
      results: [makeFailResult()],
      totalProbes: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
    };
    const text = buildProbeGateReport(report);
    assert.ok(text.includes("FAIL"));
    assert.ok(text.includes("probe_fail_test"));
    assert.ok(text.includes("canon_caution"));
    assert.ok(text.includes("observed=1"));
    assert.ok(text.includes("threshold=2"));
    assert.ok(text.includes("dimension_below_threshold"));
  });

  it("includes agent_error for probes that failed during agent turn", () => {
    const result = makePassResult({
      agentSuccess: false,
      agentError: "DB connection failed",
      passed: false,
    });
    const report: ProbeGateReport = {
      results: [result],
      totalProbes: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
    };
    const text = buildProbeGateReport(report);
    assert.ok(text.includes("FAIL"));
    assert.ok(text.includes("agent_error: DB connection failed"));
  });

  it("includes empty_reply for probes with empty agent reply", () => {
    const result = makePassResult({
      agentReply: "",
      passed: false,
    });
    const report: ProbeGateReport = {
      results: [result],
      totalProbes: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
    };
    const text = buildProbeGateReport(report);
    assert.ok(text.includes("empty_reply"));
  });

  it("includes correct summary line with totals", () => {
    const pass1 = makePassResult({ scenarioId: "p1", description: "Probe 1" });
    const pass2 = makePassResult({ scenarioId: "p2", description: "Probe 2" });
    const fail1 = makeFailResult({ scenarioId: "p3", description: "Probe 3" });
    const report: ProbeGateReport = {
      results: [pass1, pass2, fail1],
      totalProbes: 3,
      passed: 2,
      failed: 1,
      skipped: 0,
    };
    const text = buildProbeGateReport(report);
    assert.ok(text.includes("Probes: 3 total, 2 passed, 1 failed, 0 skipped"));
  });

  it("handles an empty results array gracefully", () => {
    const report: ProbeGateReport = {
      results: [],
      totalProbes: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
    };
    const text = buildProbeGateReport(report);
    assert.ok(text.includes("0 total, 0 passed, 0 failed"));
  });

  it("reports multiple failures for a single probe", () => {
    const result = makeFailResult({
      threshold: {
        scenarioId: "multi_fail",
        failures: [
          {
            type: "dimension_below_threshold",
            dimension: "canon_caution",
            observed: 1,
            threshold: 2,
            comment: 'Dimension "canon_caution" score 1 below threshold 2',
          },
          {
            type: "composite_below_threshold",
            observed: 2.5,
            threshold: 3.5,
            comment: "Composite score 2.50 below threshold 3.5",
          },
        ],
        hasFailed: true,
      },
    });
    const report: ProbeGateReport = {
      results: [result],
      totalProbes: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
    };
    const text = buildProbeGateReport(report);
    assert.ok(text.includes("canon_caution"));
    assert.ok(text.includes("composite_below_threshold"));
  });

  it("shows observed=null for null judge scores", () => {
    const result = makeFailResult({
      threshold: {
        scenarioId: "null_test",
        failures: [
          {
            type: "dimension_below_threshold",
            dimension: "style_stability",
            observed: null,
            threshold: 3,
            comment: 'Dimension "style_stability" score is null',
          },
        ],
        hasFailed: true,
      },
    });
    const report: ProbeGateReport = {
      results: [result],
      totalProbes: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
    };
    const text = buildProbeGateReport(report);
    assert.ok(text.includes("observed=null"));
    assert.ok(text.includes("style_stability"));
  });
});

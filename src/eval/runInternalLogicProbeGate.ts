/**
 * Headless internal-logic probe-gate runner (TG3).
 *
 * Loads probe scenarios from `probeScenarios.ts`, runs each through the
 * isolated agent eval pipeline, scores with the internal-logic LLM judge,
 * and applies TG2 threshold expectations. Prints a compact report and
 * exits with code 1 when any probe fails the gate.
 *
 * Usage:
 *   npx tsx src/eval/runInternalLogicProbeGate.ts
 *
 * Requires live DB + model provider keys. LangSmith credentials are
 * optional — the runner actively suppresses LangSmith tracing for the
 * full run via `withLangSmithTracingSuppressed`, so it works headlessly
 * without consuming LangSmith trace quota even when LANGSMITH_TRACING=true.
 */
import { PROBE_EVAL_SCENARIOS } from "./datasets/probeScenarios";
import { internalLogicJudgeEvaluator } from "./evaluators/internalLogicJudge";
import { evaluateProbeGateThresholds } from "./evaluators/probeGateThresholds";
import type { ThresholdFailure } from "./evaluators/probeGateThresholds";
import { runAgentEval } from "./langsmith/runAgentEval";
import type { AgentEvalOutput } from "./evalSnapshots";
import { scenarioToEvalInputs } from "./loadEvalScenarios";
import type { EvaluationResult } from "langsmith/evaluation";
import { withLangSmithTracingSuppressed } from "../observability/langsmithTracing";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProbeGateRunResult {
  scenarioId: string;
  description: string;
  /** Agent turn succeeded (non-error output). */
  agentSuccess: boolean;
  /** Agent error message, if any. */
  agentError?: string;
  /** Agent reply text, if available. */
  agentReply?: string;
  /** Judge evaluation results (7 items) or undefined if skipped. */
  judgeResults?: EvaluationResult[];
  /** Threshold evaluation result. */
  threshold: ThresholdFailure;
  /** True if probe passed the gate. */
  passed: boolean;
}

export interface ProbeGateReport {
  results: ProbeGateRunResult[];
  totalProbes: number;
  passed: number;
  failed: number;
  skipped: number;
}

// ---------------------------------------------------------------------------
// Single-probe runner
// ---------------------------------------------------------------------------

/**
 * Run a single probe: agent eval → judge scoring → threshold check.
 *
 * @param inputs - The raw input record for the scenario (from `scenarioToEvalInputs`).
 * @param expectedBehavior - Optional `expected_behavior` from the scenario metadata.
 * @returns A ProbeGateRunResult describing the outcome.
 */
export async function runSingleProbe(
  inputs: Record<string, unknown>,
  expectedBehavior?: string,
): Promise<ProbeGateRunResult> {
  const scenarioId =
    (inputs.scenario_id as string) ??
    (inputs.scenarioId as string) ??
    "unknown";
  const description = (inputs.description as string) ?? "";

  // Step 1: Run the agent eval
  let agentOutput: AgentEvalOutput;
  try {
    agentOutput = await runAgentEval(inputs);
  } catch (err) {
    return {
      scenarioId,
      description,
      agentSuccess: false,
      agentError: err instanceof Error ? err.message : String(err),
      threshold: {
        scenarioId,
        failures: [{ type: "no_results", observed: null, threshold: 0 }],
        hasFailed: true,
      },
      passed: false,
    };
  }

  if (!agentOutput.success) {
    return {
      scenarioId,
      description,
      agentSuccess: false,
      agentError: agentOutput.error,
      threshold: {
        scenarioId,
        failures: [{ type: "no_results", observed: null, threshold: 0 }],
        hasFailed: true,
      },
      passed: false,
    };
  }

  if (
    agentOutput.mode !== "agent_turn" ||
    !agentOutput.reply ||
    agentOutput.reply.trim().length === 0
  ) {
    return {
      scenarioId,
      description,
      agentSuccess: true,
      agentReply: agentOutput.reply,
      threshold: {
        scenarioId,
        failures: [
          { type: "no_results", observed: null, threshold: 0, comment: "Empty reply" },
        ],
        hasFailed: true,
      },
      passed: false,
    };
  }

  // Step 2: Score with the internal-logic judge
  const outputs: Record<string, unknown> = {
    reply: agentOutput.reply,
    mode: "agent_turn",
  };

  const metadata: Record<string, unknown> = {};
  if (expectedBehavior) {
    metadata.expected_behavior = expectedBehavior;
  }

  let judgeResults: EvaluationResult[];
  try {
    const judgeResponse = await internalLogicJudgeEvaluator({
      inputs,
      outputs,
      metadata,
    });
    judgeResults = judgeResponse.results;
  } catch (err) {
    return {
      scenarioId,
      description,
      agentSuccess: true,
      agentReply: agentOutput.reply,
      threshold: {
        scenarioId,
        failures: [
          {
            type: "no_results",
            observed: null,
            threshold: 0,
            comment: `Judge threw: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        hasFailed: true,
      },
      passed: false,
    };
  }

  // Step 3: Apply TG2 thresholds
  const threshold = evaluateProbeGateThresholds(scenarioId, judgeResults);

  return {
    scenarioId,
    description,
    agentSuccess: true,
    agentReply: agentOutput.reply,
    judgeResults,
    threshold,
    passed: !threshold.hasFailed,
  };
}

// ---------------------------------------------------------------------------
// Report builder (pure, testable without live LLM)
// ---------------------------------------------------------------------------

/**
 * Build a compact human-readable report from probe gate results.
 *
 * @returns A multi-line string suitable for stdout.
 */
export function buildProbeGateReport(report: ProbeGateReport): string {
  const lines: string[] = [];
  lines.push("=== Internal-Logic Probe Gate Report ===");
  lines.push("");

  for (const result of report.results) {
    const status = result.passed ? "PASS" : "FAIL";
    const label = `${result.scenarioId}: ${result.description}`;
    const agentInfo = result.agentSuccess
      ? result.agentReply
        ? `reply_len=${result.agentReply.length}`
        : "empty_reply"
      : `agent_error: ${result.agentError ?? "unknown"}`;

    lines.push(`  ${status}  ${label}`);
    lines.push(`        ${agentInfo}`);

    if (!result.passed && result.threshold.failures.length > 0) {
      for (const f of result.threshold.failures) {
        const dimPart = f.dimension ? `[${f.dimension}] ` : "";
        const obsPart =
          f.observed !== null ? `observed=${f.observed}` : "observed=null";
        lines.push(`        ${dimPart}${f.type}: ${obsPart}, threshold=${f.threshold}`);
        if (f.comment) {
          lines.push(`          ${f.comment}`);
        }
      }
    }
    lines.push("");
  }

  // Summary line
  const summary =
    `Probes: ${report.totalProbes} total, ` +
    `${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped`;
  lines.push(summary);
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Load probe scenarios
  const probes = PROBE_EVAL_SCENARIOS.filter(
    (s) => s.group === "probes" && s.eval_mode === "agent_turn",
  );

  if (probes.length === 0) {
    console.log("No probe scenarios found (group === 'probes'). Nothing to do.");
    process.exitCode = 0;
    return;
  }

  const results: ProbeGateRunResult[] = [];
  let passed = 0;
  let failed = 0;

  for (const probe of probes) {
    const inputs = scenarioToEvalInputs(probe);
    const expectedBehavior = (probe as unknown as Record<string, unknown>)
      .expected_behavior as string | undefined;

    console.log(`Running: ${probe.id}...`);
    const result = await runSingleProbe(inputs, expectedBehavior);

    if (result.passed) {
      passed++;
    } else {
      failed++;
    }

    results.push(result);

    // Brief per-probe status
    const status = result.passed ? "PASS" : "FAIL";
    console.log(`  ${status}  ${probe.id}  (composite judge scores from results)`);
  }

  const report: ProbeGateReport = {
    results,
    totalProbes: probes.length,
    passed,
    failed,
    skipped: 0,
  };

  const reportText = buildProbeGateReport(report);
  console.log(reportText);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

// Allow running as a CLI script (guarded: only runs when this is the main entry point)
// The entire run is wrapped in withLangSmithTracingSuppressed so that even if
// LANGSMITH_TRACING=true, no LangSmith traces are emitted by the probe gate.
const isMainModule = process.argv[1]?.replace(/\\/g, "/").endsWith("runInternalLogicProbeGate.ts");
if (isMainModule) {
  withLangSmithTracingSuppressed(main).catch((err) => {
    console.error("Probe gate runner error:", err);
    process.exitCode = 1;
  });
}

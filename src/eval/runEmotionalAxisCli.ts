// ---------------------------------------------------------------------------
// runEmotionalAxisCli.ts — Single-variant emotional-axis eval runner (TG4)
//
// Runs emotional-axis scenarios through runAgentEval, evaluates assertions
// against the emotional-axis eval snapshot, and writes result files.
//
// Usage:
//   npx tsx src/eval/runEmotionalAxisCli.ts                          # run all
//   npx tsx src/eval/runEmotionalAxisCli.ts --scenario AX01          # single
//   npx tsx src/eval/runEmotionalAxisCli.ts --dry-run                # preview only
//
// Output: eval-results/emotional-axis/latest/{results.json,summary.md,failures.md}
// ---------------------------------------------------------------------------

import * as fs from "fs";
import * as path from "path";
import { parseArgs } from "node:util";
import { loadScenariosBySet } from "./loadEvalScenarios";
import { loadPersonaOverlay } from "../character/characterDefaults";
import { checkAssertion, runAllAssertions, type AssertionContext } from "./evalAssertions";
import type { EmotionalAxisEvalSnapshot } from "./evalSnapshots";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RESULTS_DIR = path.join(__dirname, "..", "..", "eval-results", "emotional-axis", "latest");

interface ScenarioResult {
  scenarioId: string;
  description: string;
  success: boolean;
  error?: string;
  assertions: Array<{ description: string; pass: boolean; reason: string }>;
  passed: number;
  failed: number;
  emotionalAxis?: EmotionalAxisEvalSnapshot;
  latencyMs?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureResultsDir(): void {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function writeText(filePath: string, text: string): void {
  fs.writeFileSync(filePath, text, "utf-8");
}

function buildSummaryMd(results: ScenarioResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.failed === 0).length;
  const failed = total - passed;
  const totalAssertions = results.reduce((s, r) => s + r.assertions.length, 0);
  const passedAssertions = results.reduce((s, r) => s + r.passed, 0);
  const failedAssertions = totalAssertions - passedAssertions;

  const lines: string[] = [
    `# Emotional Axis Eval Summary`,
    ``,
    `Date: ${new Date().toISOString().slice(0, 10)}`,
    `Scenarios: ${total} total, ${passed} passed, ${failed} failed`,
    `Assertions: ${totalAssertions} total, ${passedAssertions} passed, ${failedAssertions} failed`,
    ``,
    `## Results by Scenario`,
    ``,
    `| Scenario | Description | Status | Passed | Failed |`,
    `|---|---|---|---|---|`,
  ];

  for (const r of results) {
    const status = r.failed === 0 ? "✓" : "✗";
    lines.push(`| ${r.scenarioId} | ${r.description} | ${status} | ${r.passed} | ${r.failed} |`);
  }

  if (failed > 0) {
    lines.push(``, `## Failed Scenarios`);
    for (const r of results) {
      if (r.failed === 0) continue;
      lines.push(``, `### ${r.scenarioId}: ${r.description}`);
      for (const a of r.assertions) {
        if (!a.pass) {
          lines.push(`- ✗ ${a.description} — ${a.reason}`);
        }
      }
      if (r.error) {
        lines.push(`- Error: ${r.error}`);
      }
    }
  }

  return lines.join("\n");
}

function buildFailuresMd(results: ScenarioResult[]): string {
  const failed = results.filter((r) => r.failed > 0 || !r.success);
  if (failed.length === 0) {
    return "# Emotional Axis Eval — No Failures\n\nAll scenarios passed.\n";
  }

  const lines: string[] = [
    `# Emotional Axis Eval — Failures`,
    ``,
    `Date: ${new Date().toISOString().slice(0, 10)}`,
    `Failed scenarios: ${failed.length}`,
    ``,
  ];

  for (const r of failed) {
    lines.push(`## ${r.scenarioId}: ${r.description}`);
    if (r.error) lines.push(``, `**Error:** ${r.error}`);
    lines.push(``, `| Assertion | Status | Reason |`);
    lines.push(`|---|---|---|`);
    for (const a of r.assertions) {
      const icon = a.pass ? "✓" : "✗";
      lines.push(`| ${a.description} | ${icon} | ${a.reason} |`);
    }
    lines.push(``);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs({
    options: {
      scenario: { type: "string", short: "s" },
      "dry-run": { type: "boolean", short: "d" },
    },
    strict: true,
  });

  const scenarioFilter = args.values.scenario;
  const dryRun = args.values["dry-run"] ?? false;
  const smokeMode = process.env.EMOTIONAL_AXIS_SMOKE === "1";

  // Load emotional-axis scenarios
  const { scenarios: allScenarios } = loadScenariosBySet("emotional_axis");
  const scenarios = scenarioFilter
    ? allScenarios.filter((s) => s.id === scenarioFilter)
    : allScenarios;

  if (scenarios.length === 0) {
    console.error(
      scenarioFilter
        ? `Scenario "${scenarioFilter}" not found in emotional_axis set.`
        : "No emotional-axis scenarios found.",
    );
    process.exitCode = 1;
    return;
  }

  console.error(`Emotional-axis eval: ${scenarios.length} scenarios (dry-run: ${dryRun}, smoke: ${smokeMode})`);

  if (dryRun) {
    console.error("\nScenarios to run:");
    for (const s of scenarios) {
      console.error(`  ${s.id}: ${s.description}`);
      console.error(`    assertions: ${s.assertions.length}`);
      if (s.seedAxisState) {
        const seed = s.seedAxisState as { axes?: Record<string, number> };
        console.error(`    seed: ${seed?.axes ? JSON.stringify(seed.axes) : "present"}`);
      }
    }
    console.error("\nDry-run complete. Pass --dry-run to preview, omit to run.");
    return;
  }

  // Smoke mode: write deterministic stub reports without model calls
  if (smokeMode) {
    ensureResultsDir();
    const stubResults: ScenarioResult[] = scenarios.map((s) => ({
      scenarioId: s.id,
      description: s.description,
      success: true,
      assertions: s.assertions.map((a) => ({
        description: a.description,
        pass: true,
        reason: "SMOKE — no model call",
      })),
      passed: s.assertions.length,
      failed: 0,
      latencyMs: 0,
    }));
    writeJson(path.join(RESULTS_DIR, "results.json"), stubResults);
    writeText(path.join(RESULTS_DIR, "summary.md"), buildSummaryMd(stubResults));
    writeText(path.join(RESULTS_DIR, "failures.md"), buildFailuresMd(stubResults));
    console.error(`\nSmoke report written to ${RESULTS_DIR}`);
    console.error(`  results.json — ${stubResults.length} scenarios`);
    console.error(`  summary.md — all SMOKE (no model calls)`);
    console.error(`  failures.md — empty (all passed in smoke mode)`);
    console.error(`\nSet EMOTIONAL_AXIS_SMOKE=1 for no-model report generation.`);
    return;
  }

  // Ensure output directory
  ensureResultsDir();

  // Dynamically import runAgentEval (avoids loading live eval code in unit tests)
  const { runAgentEval } = await import("./langsmith/runAgentEval");
  const { findScenarioForAgentEval } = await import("./agentEvalCliHelpers");
  const { buildRerankAssertionContext } = await import("./evalAssertions");

  const results: ScenarioResult[] = [];

  for (const scenario of scenarios) {
    console.error(`\n▶ ${scenario.id}: ${scenario.description}`);

    // Build the raw input from the scenario
    const rawInput = findScenarioForAgentEval(scenario.id, "emotional_axis");
    if (!rawInput) {
      results.push({
        scenarioId: scenario.id,
        description: scenario.description,
        success: false,
        error: "Scenario not found by findScenarioForAgentEval",
        assertions: [],
        passed: 0,
        failed: 0,
      });
      continue;
    }

    // Run the agent eval
    const output = await runAgentEval(rawInput);
    const emotionalAxis = output.emotionalAxis;

    // Build assertion context
    const assertionCtx: AssertionContext = {
      emotionalAxis,
      ...buildRerankAssertionContext(output.retrieval?.rerank as any),
    };

    // Evaluate assertions
    const assertionResults = runAllAssertions(scenario, output.reply, undefined, assertionCtx);
    const mapped = assertionResults.map((a) => ({
      description: a.assertionDescription,
      pass: a.pass,
      reason: a.reason,
    }));
    const passed = mapped.filter((r) => r.pass).length;
    const failed = mapped.filter((r) => !r.pass).length;

    const result: ScenarioResult = {
      scenarioId: scenario.id,
      description: scenario.description,
      success: failed === 0,
      error: output.error,
      assertions: mapped,
      passed,
      failed,
      emotionalAxis,
      latencyMs: output.latencyMs,
    };

    results.push(result);

    console.error(`  assertions: ${passed} passed, ${failed} failed`);
    if (output.error) console.error(`  error: ${output.error}`);
    if (failed > 0) {
      for (const a of mapped) {
        if (!a.pass) console.error(`    ✗ ${a.description} — ${a.reason}`);
      }
    }
  }

  // Write results
  writeJson(path.join(RESULTS_DIR, "results.json"), results);
  console.error(`\nWrote ${path.join(RESULTS_DIR, "results.json")}`);

  writeText(path.join(RESULTS_DIR, "summary.md"), buildSummaryMd(results));
  console.error(`Wrote ${path.join(RESULTS_DIR, "summary.md")}`);

  writeText(path.join(RESULTS_DIR, "failures.md"), buildFailuresMd(results));
  console.error(`Wrote ${path.join(RESULTS_DIR, "failures.md")}`);

  // Summary
  const totalPassed = results.reduce((s, r) => s + r.passed, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);
  console.error(`\n=== Summary: ${totalPassed} passed / ${totalFailed} failed ===`);

  if (totalFailed > 0) process.exitCode = 1;
}

const isMainModule =
  typeof require !== "undefined" &&
  require.main === module &&
  process.argv[1]?.includes("runEmotionalAxisCli");

if (isMainModule) {
  main().catch((err) => {
    console.error("Emotional axis eval CLI error:", err);
    process.exitCode = 1;
  });
}

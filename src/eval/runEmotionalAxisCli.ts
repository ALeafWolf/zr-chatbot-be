// ---------------------------------------------------------------------------
// runEmotionalAxisCli.ts — Emotional-axis eval runner (TG4 + TG5 variants)
//
// Runs emotional-axis scenarios through runAgentEval, evaluates assertions
// against the emotional-axis eval snapshot, and writes result files.
//
// Usage:
//   npx tsx src/eval/runEmotionalAxisCli.ts                            # run all, default variant
//   npx tsx src/eval/runEmotionalAxisCli.ts --scenario AX01            # single
//   npx tsx src/eval/runEmotionalAxisCli.ts --variant engine_no_coupling_full_render  # all, no-coupling
//   npx tsx src/eval/runEmotionalAxisCli.ts --dry-run                  # preview only
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
import { resolveEmotionalAxisVariantConfig, readEmotionalAxisVariant, type EmotionalAxisVariant } from "./experimentVariants";
import { setEmotionalAxisEvalConfig, resetEmotionalAxisEvalConfig } from "./emotionalAxisEvalConfig";

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
      variant: { type: "string", short: "v" },
      "dry-run": { type: "boolean", short: "d" },
    },
    strict: true,
  });

  const scenarioFilter = args.values.scenario;
  const variantArg = args.values.variant;
  const dryRun = args.values["dry-run"] ?? false;
  const smokeMode = process.env.EMOTIONAL_AXIS_SMOKE === "1";

  // Resolve variant (CLI arg > env var > default) — validated through readEmotionalAxisVariant
  const variant: EmotionalAxisVariant = readEmotionalAxisVariant(variantArg);
  const variantConfig = resolveEmotionalAxisVariantConfig(variant);

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

  console.error(`Emotional-axis eval: ${scenarios.length} scenarios (variant: ${variant}, dry-run: ${dryRun}, smoke: ${smokeMode})`);

  if (dryRun) {
    console.error("\nVariant config:");
    console.error(`  engineEnabled: ${variantConfig.engineEnabled}`);
    console.error(`  renderEnabled: ${variantConfig.renderEnabled}`);
    console.error(`  noCoupling: ${variantConfig.noCoupling}`);
    console.error(`  bandsOnly: ${variantConfig.bandsOnly}`);
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
    writeJson(path.join(RESULTS_DIR, "results.json"), { variant, scenarios: stubResults });
    writeText(path.join(RESULTS_DIR, "summary.md"), `# Emotional Axis Eval Summary (SMOKE)\n\nVariant: ${variant}\n\n${buildSummaryMd(stubResults)}`);
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

    // Build the raw input from the scenario, injecting variant config
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

    // TG5: Set the shared eval config for this variant run.
    // This is consumed by postTurnMemoryGraph (engine gate, no-coupling) and
    // buildPromptContext (render gate, bands-only). Design D7: injectable toggle,
    // NOT env mutation.
    setEmotionalAxisEvalConfig(variantConfig);

    // TG5: Enforce fresh session with explicit seedAxisState per run
    // (seedEvalSession already creates a unique session per call).
    // seedAxisState from the scenario is already in rawInput.

    // Run the agent eval
    const output = await runAgentEval(rawInput);

    // Reset config after each scenario to prevent cross-scenario leakage
    // (variant is constant per run, so this is defensive).
    resetEmotionalAxisEvalConfig();
    const emotionalAxis = output.emotionalAxis;

    // Build assertion context
    const assertionCtx: AssertionContext = {
      emotionalAxis,
      ...buildRerankAssertionContext(output.retrieval?.rerank as any),
    };

    // TG5: Per-variant snapshot validation
    const variantValidations: string[] = [];
    if (variantConfig.engineEnabled) {
      if (!emotionalAxis) variantValidations.push("Expected emotionalAxis update snapshot but none present");
    } else {
      if (emotionalAxis) variantValidations.push("Expected no emotionalAxis update snapshot but one present");
    }
    if (variantConfig.engineEnabled && variantConfig.renderEnabled) {
      if (!emotionalAxis?.render) variantValidations.push("Expected render snapshot but none present");
    }
    if (variantConfig.engineEnabled && !variantConfig.renderEnabled) {
      if (emotionalAxis?.render) variantValidations.push("Expected no render snapshot but one present");
    }
    if (variantConfig.noCoupling && emotionalAxis?.couplingsFired && emotionalAxis.couplingsFired.length > 0) {
      variantValidations.push(`Expected no couplings but got: ${emotionalAxis.couplingsFired.join(", ")}`);
    }
    // bandsOnly is checked at the render block content level (not assertable from snapshot metadata alone)

    // Evaluate assertions
    const assertionResults = runAllAssertions(scenario, output.reply, undefined, assertionCtx);
    const mapped = assertionResults.map((a) => ({
      description: a.assertionDescription,
      pass: a.pass,
      reason: a.reason,
    }));
    const passed = mapped.filter((r) => r.pass).length;
    const failed = mapped.filter((r) => !r.pass).length;

    const variantFailCount = variantValidations.length;
    const result: ScenarioResult = {
      scenarioId: scenario.id,
      description: scenario.description,
      success: failed === 0 && variantFailCount === 0,
      error: output.error || (variantFailCount > 0 ? variantValidations.join("; ") : undefined),
      assertions: mapped,
      passed,
      failed: failed + variantFailCount,
      emotionalAxis,
      latencyMs: output.latencyMs,
    };

    results.push(result);

    console.error(`  variant: ${variant}`);
    console.error(`  assertions: ${passed} passed, ${failed} failed`);
    if (variantFailCount > 0) {
      for (const v of variantValidations) console.error(`    ⚠ variant: ${v}`);
    }
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

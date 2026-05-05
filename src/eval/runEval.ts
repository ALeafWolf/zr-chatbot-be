/**
 * Regression eval CLI.
 *
 * Usage:
 *   npx tsx src/eval/runEval.ts
 *   npx tsx src/eval/runEval.ts --scenario no_ai_claim
 *
 * Replays scenarios from scenarios.json through runCharacterTurn (or the
 * validator directly for draft-only assertions), logs results to LangSmith,
 * and prints a pass/fail summary.
 */
import { runResponseValidator } from "../llm/runResponseValidator";
import { loadPersonaOverlay } from "../character/characterDefaults";
import type { Scenario } from "./evalTypes";
import type { ValidationResult } from "../llm/runResponseValidator";
import { runAllAssertions } from "./evalAssertions";
import { loadScenariosFromFile, STUB_REPLY } from "./loadEvalScenarios";

async function runScenario(scenario: Scenario): Promise<{
  scenarioId: string;
  passed: number;
  failed: number;
  results: Array<{ assertionDescription: string; pass: boolean; reason: string }>;
}> {
  console.log(`\n▶ ${scenario.id}: ${scenario.description}`);

  const overlay = loadPersonaOverlay(scenario.session.continuity_scope);
  let reply = "";
  let validatorResult: ValidationResult | undefined;

  if (scenario.input_draft) {
    validatorResult = await runResponseValidator({
      draft: scenario.input_draft,
      characterId: "zou_ran",
      continuityScope: scenario.session.continuity_scope,
      mode: scenario.session.mode,
      maxNsfwLevel: overlay.max_nsfw_level,
      escalationRule: overlay.escalation_rule,
      outOfScopeChapterBehavior: overlay.out_of_scope_chapter_behavior,
      recentContext: "",
    });
    reply = scenario.input_draft;
  } else {
    reply = STUB_REPLY;
    console.log(
      "  ⚠ Full turn replay skipped (requires running backend). Checking validator assertions only.",
    );
  }

  const results = runAllAssertions(scenario, reply, validatorResult);
  for (const r of results) {
    const icon = r.pass ? "✓" : "✗";
    console.log(`  ${icon} ${r.assertionDescription} — ${r.reason}`);
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  return { scenarioId: scenario.id, passed, failed, results };
}

async function main(): Promise<void> {
  const filterArg = process.argv.find((a, i) => process.argv[i - 1] === "--scenario");
  const { scenarios: all } = loadScenariosFromFile();
  const scenarios = all.filter((s) => (filterArg ? s.id === filterArg : true));

  if (scenarios.length === 0) {
    console.error(`No scenarios found${filterArg ? ` matching "${filterArg}"` : ""}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n=== Zuoran Chatbot Phase 1 Eval (${scenarios.length} scenarios) ===\n`);

  let totalPassed = 0;
  let totalFailed = 0;
  for (const scenario of scenarios) {
    const row = await runScenario(scenario);
    totalPassed += row.passed;
    totalFailed += row.failed;
  }

  console.log(
    `\n=== Summary: ${totalPassed} passed / ${totalFailed} failed ===\n`,
  );

  if (totalFailed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Eval runner error:", err);
  process.exitCode = 1;
});

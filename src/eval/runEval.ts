/**
 * Regression eval CLI.
 *
 * Usage:
 *   npx tsx src/eval/runEval.ts
 *   npx tsx src/eval/runEval.ts --scenario no_ai_claim
 *
 * Replays scenarios from scenarios.json (validator for drafts; Tier 3 retrieval
 * when eval_mode=retrieval), prints a pass/fail summary.
 */
import { runResponseValidator } from "../llm/validation/runResponseValidator";
import { loadPersonaOverlay } from "../character/characterDefaults";
import type { Scenario } from "./evalTypes";
import type { ValidationResult } from "../llm/validation/runResponseValidator";
import type { AssertionContext } from "./evalAssertions";
import { runAllAssertions } from "./evalAssertions";
import { loadScenariosFromFile, STUB_REPLY } from "./loadEvalScenarios";
import { runRetrievalEvalForScenario } from "./retrievalEvalRunner";

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
  let ctx: AssertionContext | undefined;

  if (scenario.eval_mode === "retrieval") {
    console.log("  … retrieval-only (Tier 3 + DB + embed)");
    const out = await runRetrievalEvalForScenario(scenario);
    ctx = {
      retrievedCanon: out.retrieved_canon,
      queryRewrite: out.query_rewrite,
      scene_anchor_count: out.scene_anchor_count,
    };
    reply = "";
    console.log(
      `  anchors=${out.scene_anchor_count} summary=${out.had_summary_hit} fact=${out.had_fact_hit} lex=${out.had_lex_hit} rewrite_ok=${out.query_rewrite.parseOk}`,
    );
  } else if (scenario.input_draft) {
    validatorResult = await runResponseValidator({
      draft: scenario.input_draft,
      characterId: "zuo_ran",
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

  const results = runAllAssertions(scenario, reply, validatorResult, ctx);
  for (const r of results) {
    const icon = r.pass ? "✓" : "✗";
    console.log(`  ${icon} ${r.assertionDescription} — ${r.reason}`);
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  return { scenarioId: scenario.id, passed, failed, results };
}

async function main(): Promise<void> {
  const filterArg = process.argv.find((_a, i) => process.argv[i - 1] === "--scenario");
  const { scenarios: all } = loadScenariosFromFile();
  const scenarios = all.filter((s) => (filterArg ? s.id === filterArg : true));

  if (scenarios.length === 0) {
    console.error(`No scenarios found${filterArg ? ` matching "${filterArg}"` : ""}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n=== Zuoran Chatbot Eval (${scenarios.length} scenarios) ===\n`);

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

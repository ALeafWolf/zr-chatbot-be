/**
 * Run only scenarios with eval_mode === "retrieval" (no generation).
 *
 * Usage: npx tsx src/eval/runRetrievalEvalCli.ts
 */
import { loadScenariosFromFile } from "./loadEvalScenarios";
import { runRetrievalEvalForScenario } from "./retrievalEvalRunner";
import { runAllAssertions } from "./evalAssertions";

async function main(): Promise<void> {
  const { scenarios, version } = loadScenariosFromFile();
  const retrieval = scenarios.filter((s) => s.eval_mode === "retrieval");

  console.log(`scenarios v${version} — retrieval-only: ${retrieval.length} row(s)\n`);

  let failed = 0;
  for (const scenario of retrieval) {
    console.log(`▶ ${scenario.id}`);
    const out = await runRetrievalEvalForScenario(scenario);
    const ctx = {
      retrievedCanon: out.retrieved_canon,
      queryRewrite: out.query_rewrite,
      scene_anchor_count: out.scene_anchor_count,
    };
    const results = runAllAssertions(scenario, "", undefined, ctx);
    for (const r of results) {
      const ok = r.pass ? "✓" : "✗";
      console.log(`  ${ok} ${r.assertionDescription} — ${r.reason}`);
      if (!r.pass) failed++;
    }
  }

  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

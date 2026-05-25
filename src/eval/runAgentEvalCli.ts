/**
 * Explicit local full-turn agent eval CLI.
 *
 * Runs a single scenario through `runAgentEval` (live backend code, may call
 * models) and prints a compact JSON summary.
 *
 * Usage:
 *   npx tsx src/eval/runAgentEvalCli.ts --scenario <id>
 *   EVAL_SCENARIO_SET=rerank npx tsx src/eval/runAgentEvalCli.ts --scenario rerank_001
 *
 * This CLI is manual-only and intentionally runs live backend code.
 * It is not part of unit verification.
 */
import { parseArgs } from "node:util";
import { resolveScenarioSet, validateCliArgs } from "./agentEvalCliHelpers";
import { readAndValidateExperimentVariants } from "./experimentVariants";

async function main(): Promise<void> {
  const args = parseArgs({
    options: {
      scenario: {
        type: "string",
        short: "s",
      },
    },
    strict: true,
  });

  const scenarioId = args.values.scenario;
  const scenarioSet = resolveScenarioSet();
  const validation = validateCliArgs(scenarioId, scenarioSet);

  if (!validation.ok) {
    console.error(validation.error);
    process.exitCode = validation.exitCode;
    return;
  }

  // Validate experiment variants before any model calls or traces.
  readAndValidateExperimentVariants();

  console.error(`Running agent eval for scenario "${validation.scenarioId}"...`);

  // Dynamic import: only load live eval code after all validation passes.
  // This keeps unit tests of agentEvalCliHelpers free of live imports.
  const { runAgentEval } = await import("./langsmith/runAgentEval");
  const result = await runAgentEval(validation.input);

  const summary = {
    scenarioId: result.scenarioId,
    success: result.success,
    latencyMs: result.latencyMs,
    ...(result.error ? { error: result.error } : {}),
    usage: {
      totalInputTokens: result.usage.totalInputTokens,
      totalOutputTokens: result.usage.totalOutputTokens,
      estimatedCostUsd: result.usage.estimatedCostUsd,
    },
    cleanup: result.cleanup,
    rerank: result.retrieval?.rerank
      ? {
          selected: result.retrieval.rerank.selected?.length ?? 0,
          rejectedCount: result.retrieval.rerank.rejectedCount,
          finalContextMode: result.retrieval.rerank.finalContextMode,
          fallbackUsed: result.retrieval.rerank.fallbackUsed,
        }
      : null,
  };

  // Compact JSON output
  console.log(JSON.stringify(summary, null, 2));
}

// Guard: only run main when this module is the entry point
const isMainModule =
  typeof require !== "undefined" &&
  require.main === module &&
  process.argv[1]?.includes("runAgentEvalCli");

if (isMainModule) {
  main().catch((err) => {
    console.error("Agent eval CLI error:", err);
    process.exitCode = 1;
  });
}

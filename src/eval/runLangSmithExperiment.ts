/**
 * Run a LangSmith experiment on LANGSMITH_EVAL_DATASET using the Phase 1
 * eval target (validator for input_draft rows; stub reply otherwise) and
 * assertion evaluators backed by example metadata.
 *
 * Usage:
 *   npx tsx src/eval/runLangSmithExperiment.ts
 *
 * Requires LANGSMITH_API_KEY. Push examples first: npm run eval:dataset:push
 */
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import type { EvaluationResult } from "langsmith/evaluation";
import type { Example, Run } from "langsmith/schemas";
import { env } from "../config/env";
import { loadPersonaOverlay } from "../character/characterDefaults";
import { runResponseValidator } from "../llm/runResponseValidator";
import type { ValidationResult } from "../llm/runResponseValidator";
import { checkAssertion } from "./evalAssertions";
import type { Assertion, Scenario } from "./evalTypes";
import { flushLangSmithClient } from "./evalProcessDrain";
import { loadScenariosFromFile, STUB_REPLY } from "./loadEvalScenarios";

export interface EvalTargetOutput {
  reply: string;
  validation?: ValidationResult;
  mode: "validator_only" | "skipped" | "error";
  skip_reason?: string;
  error?: string;
}

export async function evalTarget(
  inputs: Record<string, unknown>,
): Promise<EvalTargetOutput> {
  const session = inputs.session as Scenario["session"] | undefined;
  if (
    !session ||
    typeof session.mode !== "string" ||
    typeof session.continuity_scope !== "string" ||
    typeof session.continuity_family !== "string"
  ) {
    return {
      reply: "",
      mode: "error",
      error: "invalid_or_missing_session",
    };
  }

  const draft = inputs.input_draft;
  if (typeof draft === "string" && draft.length > 0) {
    const overlay = loadPersonaOverlay(session.continuity_scope);
    const validation = await runResponseValidator({
      draft,
      characterId: "zuo_ran",
      continuityScope: session.continuity_scope,
      mode: session.mode,
      maxNsfwLevel: overlay.max_nsfw_level,
      escalationRule: overlay.escalation_rule,
      outOfScopeChapterBehavior: overlay.out_of_scope_chapter_behavior,
      recentContext: "",
    });
    return { reply: draft, validation, mode: "validator_only" };
  }

  return {
    reply: STUB_REPLY,
    mode: "skipped",
    skip_reason: "no_session_replay",
  };
}

function assertionsEvaluator(args: {
  example: Example;
  outputs: Record<string, unknown>;
}): { results: EvaluationResult[] } {
  const raw = args.example.metadata?.assertions;
  const assertions = Array.isArray(raw) ? (raw as Assertion[]) : null;
  if (!assertions || assertions.length === 0) {
    const single: EvaluationResult = {
      key: "all_assertions_pass",
      score: false,
      comment: "No assertions found on example metadata.",
    };
    return { results: [single] };
  }

  const reply = typeof args.outputs.reply === "string" ? args.outputs.reply : "";
  const validation = args.outputs.validation as ValidationResult | undefined;

  const results: EvaluationResult[] = [];
  let allPass = true;
  let firstFailReason: string | undefined;

  assertions.forEach((assertion, i) => {
    const { pass, reason } = checkAssertion(assertion, reply, validation);
    if (!pass) {
      allPass = false;
      if (firstFailReason === undefined) firstFailReason = reason;
    }
    results.push({
      key: `assertion_${i}_pass`,
      score: pass,
      comment: `${assertion.description}: ${reason}`,
    });
  });

  results.unshift({
    key: "all_assertions_pass",
    score: allPass,
    comment: allPass
      ? "All assertions passed."
      : (firstFailReason ?? "One or more assertions failed."),
  });

  return { results };
}

function requireLangSmithKey(): void {
  if (!env.LANGSMITH_API_KEY?.trim()) {
    throw new Error("LANGSMITH_API_KEY is required for runLangSmithExperiment.");
  }
}

async function main(): Promise<void> {
  requireLangSmithKey();

  const client = new Client({
    apiKey: env.LANGSMITH_API_KEY,
    apiUrl: env.LANGSMITH_ENDPOINT,
  });

  let failedRows = 0;

  try {
    const { version } = loadScenariosFromFile();

    const experiment = await evaluate(evalTarget, {
      client,
      data: env.LANGSMITH_EVAL_DATASET,
      evaluators: [
        (args: {
          run: Run;
          example: Example;
          inputs: Record<string, unknown>;
          outputs: Record<string, unknown>;
          referenceOutputs?: Record<string, unknown>;
        }) =>
          assertionsEvaluator({
            example: args.example,
            outputs: args.outputs,
          }),
      ],
      experimentPrefix: "zuoran-phase1",
      maxConcurrency: 1,
      description: `Phase 1 regression — scenario assertions (scenarios v${version})`,
      metadata: {
        scenarios_file_version: version,
        langsmith_project: env.LANGSMITH_PROJECT,
      },
    });

    for await (const row of experiment) {
      const all = row.evaluationResults?.results?.find(
        (r) => r.key === "all_assertions_pass",
      );
      const ok = all?.score === true;
      if (!ok) failedRows += 1;
      const inputs = row.example.inputs as Record<string, unknown> | undefined;
      const label = inputs?.scenario_id ?? row.example.id;
      console.log(
        `${String(label)}  all_assertions_pass=${ok}  ${all?.comment ?? ""}`,
      );
    }

    console.log(`Experiment: ${experiment.experimentName}`);
    console.log(` Rows processed: ${experiment.results.length}, failed: ${failedRows}`);

    if (failedRows > 0) process.exitCode = 1;
  } finally {
    await flushLangSmithClient(client);
  }
}

main().catch((err) => {
  console.error("runLangSmithExperiment error:", err);
  process.exitCode = 1;
});

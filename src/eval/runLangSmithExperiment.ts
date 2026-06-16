/**
 * Run a LangSmith experiment on LANGSMITH_EVAL_DATASET using the Phase 1
 * eval target (validator for input_draft rows; retrieval-only for eval_mode=retrieval).
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
import { runResponseValidator } from "../llm/validation/runResponseValidator";
import type { ValidationResult } from "../llm/validation/runResponseValidator";
import type { AttributionJudgeResult } from "../llm/validation/runAttributionJudge";
import {
  buildRerankAssertionContext,
  checkAssertion,
  type AssertionContext,
} from "./evalAssertions";
import type { Assertion, Scenario } from "./evalTypes";
import { flushLangSmithClient } from "./evalProcessDrain";
import { loadScenariosFromFile, STUB_REPLY } from "./loadEvalScenarios";
import {
  rerankSelectionPrecision,
  rerankSelectionRecall,
  rerankRejectionAccuracy,
  rerankContextModeAccuracy,
  rerankCompositeScore,
} from "./evaluators/rerankEvaluators";
import {
  buildExperimentVariantMetadata,
  readAndValidateExperimentVariants,
} from "./experimentVariants";
import { runRetrievalEvalForScenario } from "./retrievalEvalRunner";
import type { QueryRewriteResult } from "../retrieval/query/rewriteQuery";
import { runAgentEval } from "./langsmith/runAgentEval";
import type { AgentEvalOutput } from "./evalSnapshots";
import { internalLogicJudgeRunEvaluator } from "./evaluators/internalLogicJudge";

export type EvalTargetOutput = AgentEvalOutput | {
  reply: string;
  validation?: ValidationResult;
  mode: "validator_only" | "skipped" | "error" | "retrieval";
  skip_reason?: string;
  error?: string;
  retrieved_canon?: string;
  query_rewrite?: Pick<
    QueryRewriteResult,
    "structuralParseOk" | "labelOk" | "parseOk" | "intent" | "confidence"
  >;
  scene_anchor_count?: number;
  had_summary_hit?: boolean;
  had_fact_hit?: boolean;
  had_lex_hit?: boolean;
  attribution_target_in_canon?: boolean;
  attribution_judge?: AttributionJudgeResult;
};

export async function evalTarget(
  inputs: Record<string, unknown>,
): Promise<EvalTargetOutput> {
  if (inputs.eval_mode === "agent_turn") {
    try {
      return await runAgentEval(inputs);
    } catch (e) {
      return {
        reply: "",
        mode: "error",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

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

  if (inputs.eval_mode === "retrieval") {
    const scenario: Scenario = {
      id: String(inputs.scenario_id ?? "unknown"),
      description: String(inputs.description ?? ""),
      session,
      messages: (inputs.messages as Scenario["messages"]) ?? [],
      assertions: [],
      retrieval_expected_needle:
        typeof inputs.retrieval_expected_needle === "string"
          ? inputs.retrieval_expected_needle
          : undefined,
    };
    try {
      const out = await runRetrievalEvalForScenario(scenario);
      const needle = scenario.retrieval_expected_needle ?? "";
      return {
        reply: "",
        mode: "retrieval",
        retrieved_canon: out.retrieved_canon,
        query_rewrite: {
          structuralParseOk: out.query_rewrite.structuralParseOk,
          labelOk: out.query_rewrite.labelOk,
          parseOk: out.query_rewrite.parseOk,
          intent: out.query_rewrite.intent,
          confidence: out.query_rewrite.confidence,
        },
        scene_anchor_count: out.scene_anchor_count,
        had_summary_hit: out.had_summary_hit,
        had_fact_hit: out.had_fact_hit,
        had_lex_hit: out.had_lex_hit,
        attribution_target_in_canon:
          needle.length > 0 ? out.retrieved_canon.includes(needle) : false,
      };
    } catch (e) {
      return {
        reply: "",
        mode: "error",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  const scenarioId =
    typeof inputs.scenario_id === "string" ? inputs.scenario_id : "";
  if (
    scenarioId === "tier4_attribution_unsupported_first_visit" &&
    !env.VALIDATOR_STRICT_ATTRIBUTION
  ) {
    return {
      reply: "",
      mode: "skipped",
      skip_reason: "requires_VALIDATOR_STRICT_ATTRIBUTION=1",
    };
  }

  const draft = inputs.input_draft;
  if (typeof draft === "string" && draft.length > 0) {
    const overlay = loadPersonaOverlay(session.continuity_scope);
    const validatorCanon =
      typeof inputs.validator_retrieved_canon === "string"
        ? inputs.validator_retrieved_canon
        : undefined;
    const validation = await runResponseValidator({
      draft,
      characterId: "zuo_ran",
      continuityScope: session.continuity_scope,
      mode: session.mode,
      maxNsfwLevel: overlay.max_nsfw_level,
      escalationRule: overlay.escalation_rule,
      outOfScopeChapterBehavior: overlay.out_of_scope_chapter_behavior,
      recentContext: "",
      retrievedCanonNarrative: validatorCanon,
    });
    return {
      reply: draft,
      validation,
      mode: "validator_only",
      ...(validation.attribution_judge
        ? { attribution_judge: validation.attribution_judge }
        : {}),
    };
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

  const outputs = args.outputs as Record<string, unknown>;
  const mode = outputs.mode as string | undefined;

  let ctx: AssertionContext | undefined;

  if (mode === "retrieval") {
    ctx = {
      retrievedCanon:
        typeof outputs.retrieved_canon === "string"
          ? outputs.retrieved_canon
          : "",
      queryRewrite: outputs.query_rewrite as QueryRewriteResult | undefined,
      scene_anchor_count:
        typeof outputs.scene_anchor_count === "number"
          ? outputs.scene_anchor_count
          : undefined,
    };
  } else if (mode === "agent_turn") {
    const retrieval = outputs.retrieval as
      | { rerank?: { selected?: Array<{ id: string; source: string }>; finalContextMode?: string; fallbackUsed?: boolean } }
      | undefined;
    const rerankCtx = buildRerankAssertionContext(retrieval?.rerank);
    // Merge rerank context (if any) with emotional-axis snapshot
    ctx = {
      ...(rerankCtx ?? {}),
      emotionalAxis: outputs.emotionalAxis as AssertionContext["emotionalAxis"],
    };
  }

  const results: EvaluationResult[] = [];
  let allPass = true;
  let firstFailReason: string | undefined;

  assertions.forEach((assertion, i) => {
    const { pass, reason } = checkAssertion(assertion, reply, validation, ctx);
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

function retrievalQualityEvaluator(args: {
  example: Example;
  outputs: Record<string, unknown>;
}): { results: EvaluationResult[] } {
  const o = args.outputs;
  if (o.mode !== "retrieval") {
    return { results: [] };
  }

  const n = typeof o.scene_anchor_count === "number" ? o.scene_anchor_count : 0;
  const inputs = args.example.inputs as Record<string, unknown> | undefined;
  const expectedNeedle =
    typeof inputs?.retrieval_expected_needle === "string"
      ? inputs.retrieval_expected_needle
      : "";

  const results: EvaluationResult[] = [
    {
      key: "retrieval_scene_anchor_count",
      score: n,
      comment: `scene_anchor_count=${n}`,
    },
    {
      key: "retrieval_had_summary_hit",
      score: o.had_summary_hit === true ? 1 : 0,
      comment: `had_summary_hit=${Boolean(o.had_summary_hit)}`,
    },
    {
      key: "retrieval_had_fact_hit",
      score: o.had_fact_hit === true ? 1 : 0,
      comment: `had_fact_hit=${Boolean(o.had_fact_hit)}`,
    },
    {
      key: "retrieval_had_lex_hit",
      score: o.had_lex_hit === true ? 1 : 0,
      comment: `had_lex_hit=${Boolean(o.had_lex_hit)}`,
    },
    {
      key: "attribution_target_in_canon",
      score: o.attribution_target_in_canon === true ? 1 : 0,
      comment:
        expectedNeedle.length > 0
          ? `needle="${expectedNeedle}" in_canon=${Boolean(o.attribution_target_in_canon)}`
          : "no needle configured",
    },
  ];

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
    const variants = readAndValidateExperimentVariants();

    const variantSuffix = [
      variants.rerankVariant !== "llm_rerank_v1" ? `rerank:${variants.rerankVariant}` : "",
      variants.retrievalVariant !== "tier3_current" ? `retrieval:${variants.retrievalVariant}` : "",
      variants.validatorVariant !== "current" ? `validator:${variants.validatorVariant}` : "",
      variants.contextPlannerVariant !== "current" ? `planner:${variants.contextPlannerVariant}` : "",
    ]
      .filter(Boolean)
      .join(" ");

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
        (args: {
          run: Run;
          example: Example;
          inputs: Record<string, unknown>;
          outputs: Record<string, unknown>;
          referenceOutputs?: Record<string, unknown>;
        }) =>
          retrievalQualityEvaluator({
            example: args.example,
            outputs: args.outputs,
          }),
        (args: {
          run: Run;
          example: Example;
          inputs: Record<string, unknown>;
          outputs: Record<string, unknown>;
          referenceOutputs?: Record<string, unknown>;
        }) =>
          rerankSelectionPrecision({
            example: args.example,
            outputs: args.outputs,
          }),
        (args: {
          run: Run;
          example: Example;
          inputs: Record<string, unknown>;
          outputs: Record<string, unknown>;
          referenceOutputs?: Record<string, unknown>;
        }) =>
          rerankSelectionRecall({
            example: args.example,
            outputs: args.outputs,
          }),
        (args: {
          run: Run;
          example: Example;
          inputs: Record<string, unknown>;
          outputs: Record<string, unknown>;
          referenceOutputs?: Record<string, unknown>;
        }) =>
          rerankRejectionAccuracy({
            example: args.example,
            outputs: args.outputs,
          }),
        (args: {
          run: Run;
          example: Example;
          inputs: Record<string, unknown>;
          outputs: Record<string, unknown>;
          referenceOutputs?: Record<string, unknown>;
        }) =>
          rerankContextModeAccuracy({
            example: args.example,
            outputs: args.outputs,
          }),
        (args: {
          run: Run;
          example: Example;
          inputs: Record<string, unknown>;
          outputs: Record<string, unknown>;
          referenceOutputs?: Record<string, unknown>;
        }) =>
          rerankCompositeScore({
            example: args.example,
            outputs: args.outputs,
          }),
        // Internal-logic probe judge (non-gating, gated by EVAL_ENABLE_LLM_JUDGE).
        // Only fires for probe rows with agent_turn replies. Emits 7 judge_* feedback
        // keys that are NEVER read by the failedRows loop below (which checks only
        // all_assertions_pass), so judge scores never affect the exit code.
        //
        // Registered as a RunEvaluator object (not a plain function) so LangSmith's
        // _resolveEvaluators() does NOT wrap it in DynamicRunEvaluator/traceable.
        // This prevents creating separate traced judge runs in the `evaluators`
        // project while preserving judge feedback on experiment rows.
        ...(env.EVAL_ENABLE_LLM_JUDGE ? [internalLogicJudgeRunEvaluator] : []),
      ],
      experimentPrefix: variantSuffix
        ? `${env.LANGSMITH_EXPERIMENT_PREFIX} (${variantSuffix})`
        : env.LANGSMITH_EXPERIMENT_PREFIX,
      maxConcurrency: 1,
      description: variantSuffix
        ? `Phase 1 regression: scenario assertions (scenarios v${version}) — variants [${variantSuffix}]`
        : `Phase 1 regression: scenario assertions (scenarios v${version})`,
      metadata: {
        scenarios_file_version: version,
        langsmith_project: env.LANGSMITH_PROJECT,
        ...buildExperimentVariantMetadata(),
      },
    });

    // Non-gating invariant: failedRows reads ONLY all_assertions_pass.
    // judge_* keys are excluded by design — they are tracked metrics only
    // and must never flip the experiment's exit code.
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

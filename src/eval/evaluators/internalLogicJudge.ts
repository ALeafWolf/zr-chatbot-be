/**
 * Internal-logic probe LLM-as-judge evaluator (M-E judge-only slice).
 *
 * Scores a character's probe reply against the 6-dimension rubric from
 * `docs/character/zuoran_internal_logic_probe_results.md`, returning 7
 * `EvaluationResult`s (6 dimensions + composite). The judge is non-gating
 * (scores are tracked metrics only, never affect pass/fail).
 *
 * TG1: pure + injectable core. No LangSmith wiring.
 *
 * This module also exports `internalLogicJudgeRunEvaluator`, a
 * LangSmith `RunEvaluator` object that bypasses `DynamicRunEvaluator`
 * wrapping. Because the object has `evaluateRun`, LangSmith's
 * `_resolveEvaluators()` does not wrap it with `traceable`, so no
 * separate traced evaluator run is created in the `evaluators` project.
 * Judge feedback is still logged via `logEvaluationFeedback`.
 */
import { z } from "zod";
import type { EvaluationResult } from "langsmith/evaluation";
import type { RunEvaluator } from "langsmith/evaluation";
import type { Run, Example } from "langsmith/schemas";
import { models } from "../../config/models";
import { chatJsonStreamWithFallback } from "../../llm/providers";

// ---------------------------------------------------------------------------
// Dimension constants
// ---------------------------------------------------------------------------

export const JUDGE_DIMENSIONS = [
  "traceability",
  "state_fit",
  "transition_friction",
  "style_stability",
  "canon_caution",
  "anti_self_analysis",
] as const;

export type JudgeDimension = (typeof JUDGE_DIMENSIONS)[number];

/** Human-readable Chinese labels for each dimension (shown in prompt). */
export const JUDGE_DIMENSION_LABELS: Record<JudgeDimension, string> = {
  traceability: "可追溯性",
  state_fit: "状态匹配",
  transition_friction: "转折摩擦",
  style_stability: "风格稳定性",
  canon_caution: "原作谨慎",
  anti_self_analysis: "反自我分析",
};

// ---------------------------------------------------------------------------
// Zod output schema
// ---------------------------------------------------------------------------

const DimensionScoreSchema = z.object({
  score: z.number().int().min(1).max(5),
  rationale: z.string(),
});

export const JudgeOutputSchema = z.object({
  dimensions: z.object({
    traceability: DimensionScoreSchema,
    state_fit: DimensionScoreSchema,
    transition_friction: DimensionScoreSchema,
    style_stability: DimensionScoreSchema,
    canon_caution: DimensionScoreSchema,
    anti_self_analysis: DimensionScoreSchema,
  }),
});

export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

export interface JudgePromptInput {
  /** Probe category, e.g. "pressure", "normal", "relaxed". */
  category: string;
  /** The last user turn that triggered this reply. */
  lastUserTurn: string;
  /** Optional per-probe expected behavior target. */
  expectedBehavior?: string;
  /** The character's reply to judge. */
  reply: string;
}

/** Scale definitions for the prompt. */
const SCALE_DESCRIPTIONS = `
- 5（显著改进）：回复在本次探测维度上表现优秀，完全符合左然的内在逻辑
- 4（符合预期）：回复表现良好，在维度上无明显问题
- 3（基本合格）：有小瑕疵但不影响整体内在逻辑一致性
- 2（部分偏离）：回复在该维度上有明显偏差
- 1（严重偏离）：回复严重违背左然在该维度的内在逻辑
`;

/**
 * Build the system and user messages for the internal-logic judge.
 *
 * The system message encodes the 6-dimension rubric verbatim from
 * `docs/character/zuoran_internal_logic_probe_results.md`. The user
 * message carries the probe context and the character's reply.
 */
export function buildInternalLogicJudgePrompt(
  input: JudgePromptInput,
): Array<{ role: "system" | "user"; content: string }> {
  const expectedSection = input.expectedBehavior
    ? `\n\n本次探测的预期行为：${input.expectedBehavior}`
    : "";

  const systemMessage = `你是一位左然（Zuo Ran）角色内在逻辑的评测专家。请根据以下六个维度，对左然在探测场景中的回复进行评分。

## 评分标准（1–5分）

${SCALE_DESCRIPTIONS}

## 六个评测维度

1. **可追溯性（traceability）**：回复是否可以追溯到左然的内在逻辑（成长环境、核心信念、核心动机、核心恐惧、防御机制、转折规则、关系阶段门控、表达约束）？
2. **状态匹配（state_fit）**：回复是否匹配当前的状态——放松/正常/压力？压力状态下防御机制是否增强？放松状态下是否更多显露？
3. **转折摩擦（transition_friction）**：如果发生了情绪转换，是否存在可见的中间步骤（停顿、回避、转移话题、确认事实）？不会跳过摩擦直接倾泻？
4. **风格稳定性（style_stability）**：避免科普模式、列表格式、生硬标签或通用助手的语气？保持角色特有的表达方式？
5. **原作谨慎（canon_caution）**：避免接受或编造虚假前提？对不确定的内容是否适当模糊或纠正？
6. **反自我分析（anti_self_analysis）**：避免直接叙述自己的心理模式（如"我习惯……""我不太擅长……"）？用行动和反应而非自我分析来表现内在逻辑？

 对每个维度给出：
- score：1–5 的整数
- rationale：简短的中文理由

只返回以下精确结构的 JSON，不要任何额外文字：
{
  "dimensions": {
    "traceability":        { "score": <1-5 整数>, "rationale": "<中文理由>" },
    "state_fit":           { "score": <1-5 整数>, "rationale": "<中文理由>" },
    "transition_friction": { "score": <1-5 整数>, "rationale": "<中文理由>" },
    "style_stability":     { "score": <1-5 整数>, "rationale": "<中文理由>" },
    "canon_caution":       { "score": <1-5 整数>, "rationale": "<中文理由>" },
    "anti_self_analysis":  { "score": <1-5 整数>, "rationale": "<中文理由>" }
  }
}`;

  const userMessage = `## 探测类别

${input.category}

## 上一条用户消息

${input.lastUserTurn}
${expectedSection}

## 左然的回复

${input.reply}

请对以上回复按六个维度评分。`;

  return [
    { role: "system", content: systemMessage },
    { role: "user", content: userMessage },
  ];
}

// ---------------------------------------------------------------------------
// Injectable judge function type & default
// ---------------------------------------------------------------------------

export type InternalLogicJudgeFn = (
  messages: Array<{ role: "system" | "user"; content: string }>,
) => Promise<JudgeOutput | null>;

/**
 * Default judge function: calls `chatJsonStreamWithFallback` on the validator model,
 * mirroring the call shape in `runResponseValidator.ts`. The streaming variant
 * disables DeepSeek thinking, which would otherwise produce empty `content` fields
 * on reasoning models like deepseek-v4-pro.
 */
export const defaultJudgeFn: InternalLogicJudgeFn = async (messages) => {
  const result = await chatJsonStreamWithFallback(
    models.validator,
    models.fallbacks.responseValidator,
    messages,
    JudgeOutputSchema,
    { maxTokens: 1024, temperature: 0.1 },
  );

  if (!result.ok) {
    console.warn(
      "[internalLogicJudge] LLM judge call failed:",
      result.error,
    );
    return null;
  }

  return result.data as JudgeOutput;
};

// ---------------------------------------------------------------------------
// Result mapping
// ---------------------------------------------------------------------------

const DIMENSION_KEYS: JudgeDimension[] = [
  "traceability",
  "state_fit",
  "transition_friction",
  "style_stability",
  "canon_caution",
  "anti_self_analysis",
];

/**
 * Map a judge output (or null/invalid) to 7 `EvaluationResult`s.
 *
 * Always returns exactly 7 results (6 dimensions + composite). Never throws.
 */
export function mapJudgeResultToEvaluationResults(
  result: JudgeOutput | null,
): EvaluationResult[] {
  const results: EvaluationResult[] = [];

  if (!result || !result.dimensions) {
    // Return null scores for all dimensions
    for (const dim of DIMENSION_KEYS) {
      results.push({
        key: `judge_${dim}`,
        score: null,
        comment: "Judge evaluation failed or returned invalid output",
      });
    }
    results.push({
      key: "judge_composite",
      score: null,
      comment: "Composite not available — judge evaluation failed",
    });
    return results;
  }

  let sum = 0;
  for (const dim of DIMENSION_KEYS) {
    const dimScore = result.dimensions[dim];
    if (dimScore && typeof dimScore.score === "number" && dimScore.score >= 1 && dimScore.score <= 5) {
      sum += dimScore.score;
      results.push({
        key: `judge_${dim}`,
        score: dimScore.score,
        comment: dimScore.rationale ?? "",
      });
    } else {
      results.push({
        key: `judge_${dim}`,
        score: null,
        comment: "Invalid dimension score in judge output",
      });
    }
  }

  const composite = sum / DIMENSION_KEYS.length;
  results.push({
    key: "judge_composite",
    score: composite,
    comment: `均值 of ${DIMENSION_KEYS.length} 个维度`,
  });

  return results;
}

// ---------------------------------------------------------------------------
// Main evaluator entry point (async, non-gating)
// ---------------------------------------------------------------------------

/**
 * Run the internal-logic judge evaluator.
 *
 * This is the main entry point used by `runLangSmithExperiment.ts`. It handles
 * gating internally:
 * - Non-probe rows → `{ results: [] }` (no judge call)
 * - Missing reply → `{ results: [] }`
 * - Flag-off → caller should skip, but we also guard internally.
 *
 * @returns 7 EvaluationResults for probe rows with a reply, or empty array.
 */
export async function internalLogicJudgeEvaluator(args: {
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  judgeFn?: InternalLogicJudgeFn;
}): Promise<{ results: EvaluationResult[] }> {
  const { inputs, outputs, metadata, judgeFn } = args;

  // Gate: probe rows only
  const group = inputs.group as string | undefined;
  if (group !== "probes") {
    return { results: [] };
  }

  // Gate: must have an agent turn reply
  const output = outputs as { reply?: string; mode?: string };
  if (output.mode !== "agent_turn" || !output.reply || output.reply.trim().length === 0) {
    return { results: [] };
  }

  // Extract context from inputs
  const messages = inputs.messages as Array<{ role: string; content: string }> | undefined;
  const lastUserTurn =
    messages && messages.length > 0
      ? messages.filter((m) => m.role === "user").slice(-1)[0]?.content ?? ""
      : "";

  const category = (inputs.description as string) ?? group;
  const expectedBehavior = (metadata?.expected_behavior as string) ?? undefined;

  // Build prompt
  const promptMessages = buildInternalLogicJudgePrompt({
    category,
    lastUserTurn,
    expectedBehavior,
    reply: output.reply,
  });

  // Call judge (injectable for tests)
  const judge = judgeFn ?? defaultJudgeFn;
  let judgeResult: JudgeOutput | null;

  try {
    judgeResult = await judge(promptMessages);
  } catch (err) {
    console.warn("[internalLogicJudge] Judge fn threw:", (err as Error).message);
    judgeResult = null;
  }

  // Map to evaluation results
  const results = mapJudgeResultToEvaluationResults(judgeResult);

  return { results };
}

// ---------------------------------------------------------------------------
// LangSmith RunEvaluator (untraced, bypasses DynamicRunEvaluator)
// ---------------------------------------------------------------------------

/**
 * Factory: create a LangSmith `RunEvaluator` for the internal-logic judge.
 *
 * Because the returned object exposes `evaluateRun`, LangSmith's
 * `_resolveEvaluators()` adds it directly without wrapping it in a
 * `DynamicRunEvaluator`. That means no `traceable` wrapper is applied and no
 * separate traced evaluator run is created in the `evaluators` project.
 *
 * The returned object's `evaluateRun` method extracts `inputs`/`outputs`/`metadata`
 * from the LangSmith `Run` and `Example` objects, delegates to
 * `internalLogicJudgeEvaluator`, and returns `{ results: EvaluationResult[] }`.
 * Judge feedback is still logged to the experiment row via `logEvaluationFeedback()`.
 *
 * @param options.judgeFn - Optional injectable judge function for testing.
 *   When omitted, `defaultJudgeFn` is used.
 *
 * @remarks
 * - Ignores `options.tracingEnabled` and `options.project_name` — no LangSmith
 *   evaluator tracing is created by design.
 * - Does not call `traceable`.
 * - Does not set `sourceRunId` to a judge/evaluator trace run.
 */
export function makeInternalLogicJudgeRunEvaluator(options?: {
  judgeFn?: InternalLogicJudgeFn;
}): RunEvaluator {
  const { judgeFn } = options ?? {};
  return {
    async evaluateRun(
      run: Run,
      example?: Example,
      _options?: unknown,
    ): Promise<{ results: EvaluationResult[] }> {
      return await internalLogicJudgeEvaluator({
        inputs: (example?.inputs ?? {}) as Record<string, unknown>,
        outputs: (run?.outputs ?? {}) as Record<string, unknown>,
        metadata: (example?.metadata as Record<string, unknown>) ?? undefined,
        judgeFn,
      });
    },
  };
}

/**
 * Production default: untraced `RunEvaluator` using the default judge function.
 *
 * Usage in `runLangSmithExperiment.ts`:
 * ```
 * evaluators: [
 *   ...,
 *   ...(env.EVAL_ENABLE_LLM_JUDGE ? [internalLogicJudgeRunEvaluator] : []),
 * ]
 * ```
 */
export const internalLogicJudgeRunEvaluator: RunEvaluator =
  makeInternalLogicJudgeRunEvaluator();

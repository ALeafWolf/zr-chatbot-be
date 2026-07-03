import { z } from "zod";
import { models } from "../../config/models";
import { env } from "../../config/env";
import { chatJsonStreamWithFallback } from "../../llm/providers";
import { traceLLMStage } from "../../observability/langsmithTracing";
import { attachTraceLlmMetadata } from "../../observability/traceMetadata";
import type { QuerySegment } from "../../retrieval/query/rewriteQuery";

// ---------------------------------------------------------------------------
// Input — distilled state (NOT the system prompt)
// ---------------------------------------------------------------------------

export interface ResponseDirectorInput {
  /** Lane-labeled segments from queryRewrite. */
  segments: QuerySegment[];
  /** Reply directions extracted from 【】 spans (TG1). Empty when none. */
  replyDirections: string[];
  /** Band line text from emotional render block (e.g. "亲近：中 情绪：中 唤起：低 克制：高"). */
  bandLine: string;
  /** Selected render rule texts (≤2 typical). */
  renderRuleTexts: string[];
  /** Last trace event type (e.g. "user_discloses_vulnerability") or undefined. */
  lastTraceEvent?: string;
  /** Derived state fields. */
  derivedState: {
    inferredMood: string;
    inferredActivity: string;
    conversationalStance: string;
  };
  /** Open thread titles. */
  openThreadTitles: string[];
  /** Latest turn delta facts. */
  latestTurnDeltaFacts: string[];
  /** Canon truth mode. */
  canonTruthMode: string;
  /** Rerank-selected source summaries (source + usageInstruction, not full bodies). */
  selectedSourceSummaries: string[];
  /** Relationship status string. */
  relationshipStatus: string;
  /** Last 2-4 recent turns, each truncated (~300 chars). */
  recentTurnPreviews: string[];
}

// ---------------------------------------------------------------------------
// Output schema — all fields defaulted so partial output degrades gracefully
// ---------------------------------------------------------------------------

export const DirectorOutputSchema = z.object({
  scene_frame: z.string().default(""),
  input_reading: z.string().default(""),
  mood_directive: z.string().default(""),
  beats: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
  direction_execution: z.string().default(""),
});

export type DirectorOutput = z.infer<typeof DirectorOutputSchema>;

// ---------------------------------------------------------------------------
// Director system prompt — forbids scripted dialogue
// ---------------------------------------------------------------------------

const DIRECTOR_SYSTEM_PROMPT = `你是一个回复导演（response director），负责为角色扮演回复提供场景框架和行为指导。

你的职责：
- 根据用户输入、情感状态、剧情上下文和场外指示，制定本轮回复的基调、节拍和方向。
- 输出应当简洁、具体、可操作。

你的限制：
- 你绝对不能编写角色的具体对白或叙事文本。
- 你只设定场景框架、情绪基调、应包含的节拍和应避免的内容。
- 回复的具体文字由演员模型（actor model）完成。

输出严格的 JSON，不要包含任何额外文本或解释。`;

// ---------------------------------------------------------------------------
// Build a human-readable input summary for the director
// ---------------------------------------------------------------------------

export function buildDirectorUserPrompt(input: ResponseDirectorInput): string {
  const parts: string[] = [
    "Return JSON only. Use this exact shape:",
    JSON.stringify({
      scene_frame: "一句话场景概括",
      input_reading: "用户本轮说出口/做出/暗示了什么（区分可感知与不可感知）",
      mood_directive: "把当前情感轴状态翻译成本轮的具体行为基调（1-2句）",
      beats: ["最多3个应包含的节拍"],
      avoid: ["最多3个应避免的点"],
      direction_execution: "如何自然执行场外指示；无场外指示时为空字符串",
    }),
    "",
    "---",
    "",
  ];

  // Lane-labeled segments in original order — reply_direction lanes are
  // inline with an off-scene marker so the director sees the true temporal
  // composition (direction content precedes in-scene speech/action).
  if (input.segments.length > 0) {
    parts.push("[用户输入分段 — 原始顺序]");
    for (const seg of input.segments) {
      const tag = seg.lane === "reply_direction" ? "（场外指示）" : "";
      parts.push(`  ${seg.lane}${tag}: ${seg.text}`);
    }
    parts.push("");
  }

  // Emotional state
  parts.push(`[情感基调] ${input.bandLine || "(无)"}`);
  if (input.renderRuleTexts.length > 0) {
    parts.push(`[情感规则] ${input.renderRuleTexts.join("；")}`);
  }
  if (input.lastTraceEvent) {
    parts.push(`[最近事件] ${input.lastTraceEvent}`);
  }
  parts.push("");

  // Derived state
  parts.push(`[推断状态] 情绪: ${input.derivedState.inferredMood}, 活动: ${input.derivedState.inferredActivity}, 立场: ${input.derivedState.conversationalStance}`);

  // Open threads
  if (input.openThreadTitles.length > 0) {
    parts.push(`[未完结线索] ${input.openThreadTitles.join("；")}`);
  }

  // Latest turn delta
  if (input.latestTurnDeltaFacts.length > 0) {
    parts.push(`[最近变化] ${input.latestTurnDeltaFacts.join("；")}`);
  }

  // Canon truth mode
  parts.push(`[剧情模式] ${input.canonTruthMode}`);

  // Selected sources
  if (input.selectedSourceSummaries.length > 0) {
    parts.push("[选中来源]");
    for (const s of input.selectedSourceSummaries) {
      parts.push(`  - ${s}`);
    }
  }

  // Relationship status
  parts.push(`[关系状态] ${input.relationshipStatus}`);

  // Recent turn previews
  if (input.recentTurnPreviews.length > 0) {
    parts.push("[最近对白]");
    for (const t of input.recentTurnPreviews) {
      parts.push(`  ${t}`);
    }
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Render director output to a [DIRECTOR NOTE] block
// ---------------------------------------------------------------------------

export function renderDirectorNote(output: DirectorOutput): string {
  // Each field is its own section joined by a blank line. List sections keep their
  // items on single newlines but are blank-line separated from surrounding sections
  // so a Markdown renderer does not lazily continue the following header into the
  // last list item (and the drafter model reads unambiguous boundaries).
  const sections: string[] = [];

  if (output.scene_frame) sections.push(`场景框架：${output.scene_frame}`);
  if (output.input_reading) sections.push(`输入解读：${output.input_reading}`);
  if (output.mood_directive) sections.push(`行为基调：${output.mood_directive}`);
  if (output.beats.length > 0) {
    sections.push(["应包含的节拍：", ...output.beats.map((b) => `- ${b}`)].join("\n"));
  }
  if (output.avoid.length > 0) {
    sections.push(["应避免的：", ...output.avoid.map((a) => `- ${a}`)].join("\n"));
  }
  if (output.direction_execution) {
    sections.push(`方向执行：${output.direction_execution}`);
  }

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Traced director stage
// ---------------------------------------------------------------------------

const tracedDirector = traceLLMStage(
  "llm.response_director",
  async (input: {
    payload: ResponseDirectorInput;
    signal?: AbortSignal;
  }): Promise<DirectorOutput | null> => {
    const userPrompt = buildDirectorUserPrompt(input.payload);

    const res = await chatJsonStreamWithFallback<DirectorOutput>(
      models.director,
      models.fallbacks.responseDirector,
      [
        { role: "system", content: DIRECTOR_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      DirectorOutputSchema,
      { maxTokens: 700, temperature: 0.1, signal: input.signal },
    );

    if (!res.ok) return null;
    return attachTraceLlmMetadata(res.data, {
      binding: res.binding,
      modelRole: "director",
      usage: res,
      fallback: { used: res.fallbackUsed, attempts: res.fallbackAttempts },
    });
  },
  {
    subsystem: "llm",
    turn: "foreground",
    llm: { binding: models.director, modelRole: "director" },
    // processInputs receives the single input object directly
    processInputs: (inputs) => {
      const input = inputs as { payload?: ResponseDirectorInput };
      const payload = input?.payload;
      if (!payload) return {};
      return {
        segmentCount: payload.segments.length,
        replyDirectionCount: payload.replyDirections.length,
        bandLineChars: payload.bandLine.length,
        ruleTextCount: payload.renderRuleTexts.length,
        recentTurnCount: payload.recentTurnPreviews.length,
        openThreadCount: payload.openThreadTitles.length,
      };
    },
    processOutputs: (outputs) => {
      const o = outputs as unknown as DirectorOutput;
      return {
        sceneFramePresent: (o.scene_frame?.length ?? 0) > 0,
        inputReadingPresent: (o.input_reading?.length ?? 0) > 0,
        moodDirectivePresent: (o.mood_directive?.length ?? 0) > 0,
        beatCount: o.beats?.length ?? 0,
        avoidCount: o.avoid?.length ?? 0,
        directionExecutionChars: o.direction_execution?.length ?? 0,
      };
    },
  },
);

// ---------------------------------------------------------------------------
// Public API — fail-open wrapper
// ---------------------------------------------------------------------------

/**
 * Run the response director stage.
 *
 * Returns a rendered [DIRECTOR NOTE] block string when the director call succeeds
 * and the block is non-empty. Returns null when the director is disabled, the
 * call fails, or the rendered block is empty (fail-open — the turn proceeds
 * without the block).
 */
export async function runResponseDirector(
  input: ResponseDirectorInput,
  options?: { signal?: AbortSignal },
): Promise<string | null> {
  if (!env.RESPONSE_DIRECTOR_ENABLED) {
    return null;
  }

  try {
    const output = await tracedDirector({
      payload: input,
      signal: options?.signal,
    });

    if (!output) {
      console.warn("[runResponseDirector] director returned null — skipping DIRECTOR NOTE block");
      return null;
    }

    const rendered = renderDirectorNote(output);
    if (!rendered.trim()) {
      console.warn("[runResponseDirector] rendered block is empty — skipping");
      return null;
    }

    return rendered;
  } catch (err) {
    console.warn("[runResponseDirector] error:", err);
    return null;
  }
}

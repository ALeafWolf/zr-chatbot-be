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
  /** TG5: Deterministic character-core digest (empty string when unavailable). */
  characterDigest: string;
  /** TG5: Continuity scope for stage-gating awareness (empty string when unavailable). */
  continuityScope: string;
  /** TG1 (phase2c): Bounded one-line previews of retrieved memory content
   *  (empty array when none). Lets fact_correction fire on memory-grounded
   *  false premises. */
  memoryEntryPreviews: string[];
}

// ---------------------------------------------------------------------------
// Output schema — all fields defaulted so partial output degrades gracefully
// ---------------------------------------------------------------------------

export const DirectorOutputSchema = z.object({
  scene_frame: z.string().default(""),
  input_reading: z.string().default(""),
  mood_directive: z.string().default(""),
  fact_correction: z.string().default(""),
  beats: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
  stage_gate: z.string().default(""),
  format_resistance: z.string().default(""),
  direction_execution: z.string().default(""),
});

export type DirectorOutput = z.infer<typeof DirectorOutputSchema>;

// ---------------------------------------------------------------------------
// TG6: Director run result — note for prompt injection + output for
// fired-check-driven slimming
// ---------------------------------------------------------------------------

export interface DirectorRunResult {
  /** Rendered [DIRECTOR NOTE] body (non-empty). */
  note: string;
  /** Parsed schema output (for fired-field checks). */
  output: DirectorOutput;
}

// ---------------------------------------------------------------------------
// Director system prompt — forbids scripted dialogue
// ---------------------------------------------------------------------------

const DIRECTOR_SYSTEM_PROMPT = `你是一个回复导演（response director），负责为角色扮演回复提供场景框架和行为指导。

你的职责：
- 根据用户输入、情感状态、剧情上下文和场外指示，制定本轮回复的基调、节拍和方向。
- 利用角色内核摘要（[角色内核摘要]）中的防御机制和状态转换规则来指导节拍和应避免的内容。
- 输出应当简洁、具体、可操作。

你的限制：
- 你绝对不能编写角色的具体对白或叙事文本。
- 你只设定场景框架、情绪基调、应包含的节拍和应避免的内容。
- 回复的具体文字由演员模型（actor model）完成。
- 节拍和应避免的内容必须与角色的防御机制和状态转换规则保持一致——不得指示跳过 克制 → 停顿 → 试探性松动 的中间状态。
- 绝不指示角色进行自我剖析式的语言坦白或解释自己的心理活动。

输入-读取（input_reading）规则：
- input_reading 只能描述 [用户输入分段 — 原始顺序] 的内容——角色本轮实际说出口、做出或暗示的行为。
- [最近变化] 和 [最近对白] 是背景信息，帮助判断连续性，但 input_reading 不应包含或描述它们的内容。
- 当 [用户输入分段] 中包含指令性文本时（标记为（场外指示）），在 input_reading 中说明这是场外指导，不应描述为角色的实际言行。

条件字段约束：
- fact_correction、stage_gate、format_resistance 仅在触发时填写；未触发时保持空字符串是正确的输出，不是遗漏。
- fact_correction 的触发依据增加一条：当用户输入的前提与 [记忆要点] 中的既有记忆明确矛盾时填写；仅在明确矛盾时触发，模糊或缺证据时留空。
- 未触发的条件字段留空字符串是正确行为，不要为了填充而填充。

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
      fact_correction: "仅当用户前提与已知事实冲突时填写：先平静纠正哪个事实；未触发时留空字符串",
      beats: ["最多3个应包含的节拍"],
      avoid: ["最多3个应避免的点"],
      stage_gate: "仅当需要声明本轮亲密/松动上限时填写；未触发时留空字符串",
      format_resistance: "仅当用户要求对个人情感内容进行逐项/框架式回答时填写；未触发时留空字符串",
      direction_execution: "如何自然执行场外指示；无场外指示时为空字符串",
    }),
    "",
    "---",
    "",
  ];

  // TG5: Character-core digest — first context section, frames everything after
  if (input.characterDigest) {
    parts.push(`[角色内核摘要]\n${input.characterDigest}`);
    parts.push("");
  }

  // TG1 (PR review): Fallback [场外指示] section when reply directions exist but
  // queryRewrite produced no reply_direction segment.
  if (input.replyDirections.length > 0 && !input.segments.some((s) => s.lane === "reply_direction")) {
    parts.push("[场外指示]");
    for (const dir of input.replyDirections) {
      parts.push(`- ${dir}`);
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

  // Canon truth mode
  parts.push(`[剧情模式] ${input.canonTruthMode}`);

  // Selected sources
  if (input.selectedSourceSummaries.length > 0) {
    parts.push("[选中来源]");
    for (const s of input.selectedSourceSummaries) {
      parts.push(`  - ${s}`);
    }
  }

  // TG1 (phase2c): Memory entry previews — for fact_correction on false premises
  if (input.memoryEntryPreviews.length > 0) {
    parts.push("[记忆要点]（既有记忆的摘要，用于核对用户前提；不是台词素材，不得转写进任何输出字段）");
    for (const p of input.memoryEntryPreviews) {
      parts.push(`- ${p}`);
    }
  }

  // Relationship status + continuity scope (TG5)
  parts.push(`[关系状态] ${input.relationshipStatus}`);
  if (input.continuityScope) {
    parts.push(`[连续性范围] ${input.continuityScope}`);
  }

  // Latest turn delta — truncated to ~120 chars per item to prevent
  // director recency-anchoring on the previous turn's full text (TG2.1).
  if (input.latestTurnDeltaFacts.length > 0) {
    const MAX_DELTA_ITEM_CHARS = 120;
    const truncated = input.latestTurnDeltaFacts.map(
      (f) => f.length > MAX_DELTA_ITEM_CHARS ? f.slice(0, MAX_DELTA_ITEM_CHARS) + "…" : f,
    );
    parts.push(`[最近变化] ${truncated.join("；")}`);
  }

  // Recent turn previews
  if (input.recentTurnPreviews.length > 0) {
    parts.push("[最近对白]");
    for (const t of input.recentTurnPreviews) {
      parts.push(`  ${t}`);
    }
  }

  // TG2.1: [用户输入分段] moved to the END (recency slot) so the flash model
  // at temp 0.1 anchors on the current turn's input, not the previous turn's
  // delta or history.
  if (input.segments.length > 0) {
    parts.push("[用户输入分段 — 原始顺序]");
    for (const seg of input.segments) {
      const tag = seg.lane === "reply_direction" ? "（场外指示）" : "";
      parts.push(`  ${seg.lane}${tag}: ${seg.text}`);
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
  //
  // Note order (per design Part 3): 场景框架 → 输入解读 → 事实纠正(TG5) → 行为基调 →
  // 阶段门控(TG5) → 应包含的节拍 → 应避免的 → 格式抗性(TG5) → 方向执行
  const sections: string[] = [];

  if (output.scene_frame) sections.push(`场景框架：${output.scene_frame}`);
  if (output.input_reading) sections.push(`输入解读：${output.input_reading}`);
  if (output.fact_correction) sections.push(`事实纠正：${output.fact_correction}`);
  if (output.mood_directive) sections.push(`行为基调：${output.mood_directive}`);
  if (output.stage_gate) sections.push(`阶段门控：${output.stage_gate}`);
  if (output.beats.length > 0) {
    sections.push(["应包含的节拍：", ...output.beats.map((b) => `- ${b}`)].join("\n"));
  }
  if (output.avoid.length > 0) {
    sections.push(["应避免的：", ...output.avoid.map((a) => `- ${a}`)].join("\n"));
  }
  if (output.format_resistance) sections.push(`格式抗性：${output.format_resistance}`);
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
      { maxTokens: 900, temperature: 0.1, signal: input.signal },
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
        characterDigestChars: payload.characterDigest?.length ?? 0,
        continuityScopeChars: payload.continuityScope?.length ?? 0,
        memoryEntryPreviewCount: payload.memoryEntryPreviews?.length ?? 0,
      };
    },
    processOutputs: (outputs) => {
      // tracedDirector returns DirectorOutput | null — guard null to avoid
      // throwing under LangSmith tracing (PR review TG1.4).
      const o = outputs as unknown as DirectorOutput | null | undefined;
      if (!o) return {};
      return {
        sceneFramePresent: (o.scene_frame?.length ?? 0) > 0,
        inputReadingPresent: (o.input_reading?.length ?? 0) > 0,
        moodDirectivePresent: (o.mood_directive?.length ?? 0) > 0,
        factCorrectionFired: (o.fact_correction?.length ?? 0) > 0,
        beatCount: o.beats?.length ?? 0,
        avoidCount: o.avoid?.length ?? 0,
        stageGateFired: (o.stage_gate?.length ?? 0) > 0,
        formatResistanceFired: (o.format_resistance?.length ?? 0) > 0,
        directionExecutionChars: o.direction_execution?.length ?? 0,
      };
    },
  },
);

// ---------------------------------------------------------------------------
// Deadline composition (TG3)
// ---------------------------------------------------------------------------

/**
 * Compose a per-step deadline signal with any inbound signal so either source
 * can abort the director call. Returns the composed signal plus a `clear()`
 * that cancels the deadline timer — call it in a `finally` so a fast success
 * never leaves a dangling timeout or fires a post-resolution abort. When
 * `deadlineMs <= 0` the inbound signal is passed through unchanged.
 */
export function createDirectorDeadlineSignal(
  inbound: AbortSignal | undefined,
  deadlineMs: number,
): { signal: AbortSignal | undefined; clear: () => void } {
  if (deadlineMs <= 0) return { signal: inbound, clear: () => {} };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  const signals: AbortSignal[] = [controller.signal];
  if (inbound) signals.push(inbound);
  return { signal: AbortSignal.any(signals), clear: () => clearTimeout(timer) };
}

// ---------------------------------------------------------------------------
// Public API — fail-open wrapper
// ---------------------------------------------------------------------------

/**
 * Run the response director stage.
 *
 * Returns a `DirectorRunResult` (rendered note + parsed output) when the
 * director call succeeds and the note is non-empty. Returns null when the
 * director is disabled, the call fails, or the rendered note is empty
 * (fail-open — the turn proceeds without the block).
 *
 * TG6: The caller uses `output` for fired-field checks to drive prompt
 * slimming before appending the note.
 */
export async function runResponseDirector(
  input: ResponseDirectorInput,
  options?: { signal?: AbortSignal },
): Promise<DirectorRunResult | null> {
  if (!env.RESPONSE_DIRECTOR_ENABLED) {
    return null;
  }

  // TG3: Per-step deadline abort composed with any inbound signal. On timeout
  // the director is aborted and the turn proceeds via the null path (fail-open).
  const { signal: directorSignal, clear: clearDeadline } =
    createDirectorDeadlineSignal(options?.signal, env.RESPONSE_DIRECTOR_DEADLINE_MS);

  try {
    const output = await tracedDirector({
      payload: input,
      signal: directorSignal,
    });

    if (!output) {
      console.warn("[runResponseDirector] director returned null — skipping DIRECTOR NOTE block");
      return null;
    }

    // PR review TG1.5: Clamp beats/avoid to ≤3 after parse so an over-length
    // list degrades gracefully instead of failing the whole director output.
    // Uses slice(0,3) rather than .max(3) to avoid breaking the parse.
    output.beats = output.beats.slice(0, 3);
    output.avoid = output.avoid.slice(0, 3);

    const note = renderDirectorNote(output);
    if (!note.trim()) {
      console.warn("[runResponseDirector] rendered note is empty — skipping");
      return null;
    }

    return { note, output };
  } catch (err) {
    console.warn("[runResponseDirector] error:", err);
    return null;
  } finally {
    // Cancel the deadline timer so a fast success never leaves a dangling
    // timeout (no post-resolution abort, no leaked handle).
    clearDeadline();
  }
}

import { z } from "zod";
import { chatJsonWithFallback } from "../providers";
import { models } from "../../config/models";
import { attachTraceLlmMetadata } from "../../observability/traceMetadata";
import { traceLLMStage } from "../../observability/langsmithTracing";
import type { MessageRow } from "../../retrieval/conversation/getMessagesByTurnRange";
import {
  SESSION_SUMMARY_MAX_SITUATION_CHARS,
  extractMergerEnvelopeBody,
  isNonEmptyMergerBody,
  mergeMergerPayloadIntoExisting,
  type SessionSummaryJson,
  normalizeSessionSummaryJson,
} from "../../memory/session/sessionSummaryJson";
import { renderSessionSummaryForPrompt } from "../../memory/session/renderSessionSummaryForPrompt";

/** Accept wrapper or bare summary object; validated only loosely before merge/coerce. */
const MergerLooseEnvelopeSchema = z
  .object({
    summary_json: z.unknown().optional(),
  })
  .passthrough();

const MERGER_SYSTEM = `你是角色扮演对话系统的会话摘要合并器。
你将收到：(1) 现有结构化会话摘要 JSON；(2) 一段更早的原始对话片段（含每条消息的回合序号）。

任务：将新片段中有长期连续价值的信息合并进现有摘要，而不是重写一切。

规则：
- 保留仍然成立的事实与线索；若新片段推翻了旧信息，在 contradictionsOrCorrections 中记录，并更新相关字段。
- 将可在后续回合延续的线索写入 openThreads，状态可为 open / paused / resolved。
- 不要将只属于「最近 Raw 窗口」才会发生的细枝末节硬塞进来，除非对连续性必要。
- relationshipState 仅在情感/关系基调明显变化时更新；可写 recentShift。
- userPreferences 中 scope=possibly_durable 仅用于可能跨场次仍成立的偏好；纯本场玩笑用 this_session。
- currentSituation 用压缩后的叙事 prose 概括「现有摘要 + 新片段」中已离开 Raw 窗口的剧情，不要逐条复制 [回合 n] 原文格式。
- 全程使用中文。输出必须是 JSON。

优先返回 {"summary_json": { ... } }；顶层字段也可直接为摘要对象（与 summary_json 内容相同）。`;

function formatSegment(messages: MessageRow[]): string {
  return messages
    .map((m) => {
      const who = m.role === "user" ? "用户" : "对方";
      return `[回合 ${m.turnIndex}] ${who}：${m.content}`;
    })
    .join("\n");
}

/** Keep the tail so newer compacted segments are not dropped by a prefix clip. */
function clipSituationJoinTail(
  existingSituation: string,
  segmentBody: string,
  maxChars: number,
): string {
  const joined = [existingSituation, segmentBody].filter(Boolean).join("\n\n");
  if (joined.length <= maxChars) return joined;
  const omitted = joined.length - maxChars;
  return `…[更早内容已截断，约省略 ${omitted} 字；以下为保留的末尾片段]\n\n${joined.slice(-maxChars)}`;
}

function buildFallbackSummary(
  existing: SessionSummaryJson,
  segmentBody: string,
): SessionSummaryJson {
  return {
    ...existing,
    currentSituation: clipSituationJoinTail(
      existing.currentSituation,
      segmentBody,
      SESSION_SUMMARY_MAX_SITUATION_CHARS,
    ),
  };
}

export interface RunSessionSummaryMergerInput {
  existingSummaryJson: unknown;
  messages: MessageRow[];
  fromTurnIndex: number;
  toTurnIndex: number;
}

export interface RunSessionSummaryMergerResult {
  summaryJson: SessionSummaryJson;
  summaryText: string;
}

/**
 * Merge existing structured summary with a compacted transcript segment (Phase 2).
 * Renders summary_text from summary_json for a single source of truth.
 */
async function runSessionSummaryMergerImpl(
  input: RunSessionSummaryMergerInput,
): Promise<RunSessionSummaryMergerResult> {
  const existing = normalizeSessionSummaryJson(input.existingSummaryJson);
  const segmentBody = formatSegment(input.messages);

  const userContent = `
要合并的回合区间（含端点）：${input.fromTurnIndex}–${input.toTurnIndex}

现有摘要 JSON：
${JSON.stringify(existing, null, 2)}

新片段（即将离开 Raw 窗口的更旧内容）：
${segmentBody || "（空片段）"}

请输出 {"summary_json": { ...完整结构化摘要... }} 。`.trim();

  const result = await chatJsonWithFallback(
    models.extractor,
    models.fallbacks.sessionSummaryMerger,
    [
      { role: "system", content: MERGER_SYSTEM },
      { role: "user", content: userContent },
    ],
    MergerLooseEnvelopeSchema,
    { maxTokens: 8192, temperature: 0.2 },
  );

  if (!result.ok) {
    console.warn(
      "[runSessionSummaryMerger] chatJson failed; keeping existing summary with segment appended to situation (tail-clipped).",
      result.error,
    );
    const fallback = buildFallbackSummary(existing, segmentBody);
    return attachTraceLlmMetadata(
      {
        summaryJson: fallback,
        summaryText: renderSessionSummaryForPrompt(fallback),
      },
      {
        binding: result.binding,
        modelRole: "extractor",
        usage: result,
        fallback: { used: result.fallbackUsed, attempts: result.fallbackAttempts },
      },
    );
  }

  const body = extractMergerEnvelopeBody(result.data);
  if (body === null || !isNonEmptyMergerBody(body)) {
    console.warn(
      "[runSessionSummaryMerger] missing or empty summary body after parse; using tail-append fallback.",
    );
    const fallback = buildFallbackSummary(existing, segmentBody);
    return attachTraceLlmMetadata(
      {
        summaryJson: fallback,
        summaryText: renderSessionSummaryForPrompt(fallback),
      },
      {
        binding: result.binding,
        modelRole: "extractor",
        usage: result,
        fallback: { used: result.fallbackUsed, attempts: result.fallbackAttempts },
      },
    );
  }

  const summaryJson = mergeMergerPayloadIntoExisting(existing, body);

  return attachTraceLlmMetadata(
    {
      summaryJson,
      summaryText: renderSessionSummaryForPrompt(summaryJson),
    },
    {
      binding: result.binding,
      modelRole: "extractor",
      usage: result,
      fallback: { used: result.fallbackUsed, attempts: result.fallbackAttempts },
    },
  );
}

export const runSessionSummaryMerger = traceLLMStage(
  "llm.session_summary_merger",
  runSessionSummaryMergerImpl,
  {
    subsystem: "llm",
    turn: "background",
    llm: { binding: models.extractor, modelRole: "extractor" },
  },
);

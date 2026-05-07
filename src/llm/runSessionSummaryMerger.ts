import { z } from "zod";
import { chatJson } from "./providers";
import { models } from "../config/models";
import type { MessageRow } from "../retrieval/getMessagesByTurnRange";
import {
  SessionSummaryJsonSchema,
  type SessionSummaryJson,
  normalizeSessionSummaryJson,
} from "../memory/sessionSummaryJson";
import { renderSessionSummaryForPrompt } from "../memory/renderSessionSummaryForPrompt";

const MergerOutputSchema = z.object({
  summary_json: SessionSummaryJsonSchema,
});

const MERGER_SYSTEM = `你是角色扮演对话系统的会话摘要合并器。
你将收到：(1) 现有结构化会话摘要 JSON；(2) 一段更早的原始对话片段（含每条消息的回合序号）。

任务：将新片段中有长期连续价值的信息合并进现有摘要，而不是重写一切。

规则：
- 保留仍然成立的事实与线索；若新片段推翻了旧信息，在 contradictionsOrCorrections 中记录，并更新相关字段。
- 将可在后续回合延续的线索写入 openThreads，状态可为 open / paused / resolved。
- 不要将只属于「最近 Raw 窗口」才会发生的细枝末节硬塞进来，除非对连续性必要。
- relationshipState 仅在情感/关系基调明显变化时更新；可写 recentShift。
- userPreferences 中 scope=possibly_durable 仅用于可能跨场次仍成立的偏好；纯本场玩笑用 this_session。
- 全程使用中文。输出必须是 JSON。

返回 JSON，且仅包含键 summary_json，其值必须符合约定的结构化字段。`;

function formatSegment(messages: MessageRow[]): string {
  return messages
    .map((m) => {
      const who = m.role === "user" ? "用户" : "对方";
      return `[回合 ${m.turnIndex}] ${who}：${m.content}`;
    })
    .join("\n");
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
export async function runSessionSummaryMerger(
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

  const result = await chatJson(
    models.extractor,
    [
      { role: "system", content: MERGER_SYSTEM },
      { role: "user", content: userContent },
    ],
    MergerOutputSchema,
    { maxTokens: 4096, temperature: 0.2 },
  );

  if (!result.ok) {
    console.warn(
      "[runSessionSummaryMerger] chatJson failed; keeping existing summary with segment appended to situation.",
      result.error,
    );
    const fallback: SessionSummaryJson = {
      ...existing,
      currentSituation: [existing.currentSituation, segmentBody]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 6000),
    };
    return {
      summaryJson: fallback,
      summaryText: renderSessionSummaryForPrompt(fallback),
    };
  }

  const summaryJson = result.data.summary_json;
  return {
    summaryJson,
    summaryText: renderSessionSummaryForPrompt(summaryJson),
  };
}

import { createHash } from "crypto";
import { chatWithFallback } from "../providers";
import { models, type ModelBinding } from "../../config/models";
import type { ThoughtKind } from "../../orchestration/thought/thoughtTypes";
import { attachTraceLlmMetadata } from "../../observability/traceMetadata";

export interface ThoughtSummaryInput {
  characterName: string;
  stage: ThoughtKind;
  context: Record<string, unknown>;
  voiceHints?: string;
}

export interface ThoughtSummaryResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheHit: boolean;
  binding?: ModelBinding;
  fallbackUsed?: boolean;
}

function hashKey(parts: unknown[]): string {
  const h = createHash("sha256");
  for (const p of parts) {
    h.update(typeof p === "string" ? p : JSON.stringify(p));
    h.update("\x1e");
  }
  return h.digest("hex").slice(0, 24);
}

/**
 * One short Chinese sentence in first-person character voice (cheap extractor model).
 */
export async function generateThoughtSummary(
  input: ThoughtSummaryInput,
  cache: Map<string, string>,
): Promise<string> {
  const result = await generateThoughtSummaryWithUsage(input, cache);
  return result.text;
}

export async function generateThoughtSummaryWithUsage(
  input: ThoughtSummaryInput,
  cache: Map<string, string>,
): Promise<ThoughtSummaryResult> {
  const key = hashKey([input.stage, input.characterName, input.context]);
  const hit = cache.get(key);
  if (hit) {
    return {
      text: hit,
      inputTokens: 0,
      outputTokens: 0,
      cacheHit: true,
    };
  }

  const system =
    "你是角色扮演助手。根据给定情境，用角色的口吻输出恰好一句内心独白。" +
    "要求：第一人称；口语自然；最多50个汉字；不要引号；不要Markdown；不要复述指令。";

  const user =
    `角色名：${input.characterName}\n` +
    `阶段：${input.stage}\n` +
    (input.voiceHints ? `口吻提示：${input.voiceHints}\n` : "") +
    `情境(JSON)：${JSON.stringify(input.context)}\n` +
    "只输出那一句独白。";

  const res = await chatWithFallback(
    models.extractor,
    models.fallbacks.recallThought,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    {
      maxTokens: 80,
      temperature: 0.7,
      ...(models.extractor.provider === "deepseek"
        ? { openAICompatibleRequestExtensions: { thinking: { type: "disabled" as const } } }
        : {}),
    },
  );

  const line =
    res.content.replace(/\s+/g, " ").trim().slice(0, 80) ||
    "我得先理清这些。";
  cache.set(key, line);
  return attachTraceLlmMetadata(
    {
      text: line,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      cacheHit: false,
      binding: res.binding,
      fallbackUsed: res.fallbackUsed,
    },
    {
      binding: res.binding,
      modelRole: "extractor",
      usage: {
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
      },
    },
  );
}

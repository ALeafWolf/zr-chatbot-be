import { z } from "zod";
import { models } from "../../config/models";
import { chatJsonWithFallback } from "../../llm/providers";
import { traceLLMStage } from "../../observability/langsmithTracing";
import { attachTraceLlmMetadata } from "../../observability/traceMetadata";
import type { ConsolidationCandidateEntry } from "./structmemConsolidationSelection";
import type { StructMemStableCategory } from "./structmemPhase4Policy";
import { normalizeStableCategory } from "./structmemPhase4Policy";

export const StructMemConsolidationOutputSchema = z.object({
  summary_text: z.string().trim().min(1).max(3000),
  summary_json: z.record(z.unknown()).default({}),
  confidence_score: z.number().min(0).max(1).nullable().default(null),
});

export type StructMemConsolidationOutput = z.infer<
  typeof StructMemConsolidationOutputSchema
>;

export type StructMemConsolidationSynthesisResult =
  StructMemConsolidationOutput & {
    telemetry: {
      model: string;
      provider: string;
      inputTokens: number;
      outputTokens: number;
    };
  };

const StableCategorySchema = z.preprocess(
  normalizeStableCategory,
  z.enum([
    "promise_or_commitment",
    "stable_relationship_pattern",
    "relationship_milestone",
    "recurring_preference",
    "repeated_habit",
    "interaction_style_or_inside_joke",
  ] satisfies [StructMemStableCategory, ...StructMemStableCategory[]]),
);

const StructMemCrossSessionItemSchema = z.object({
  category: StableCategorySchema,
  summary_text: z.string().trim().min(1).max(1200),
  confidence_score: z.number().min(0).max(1),
  importance_score: z.number().min(0).max(1).default(0.75),
  tags: z.array(z.string().trim().min(1)).max(8).default([]),
});

const MAX_CROSS_SESSION_STABLE_ITEMS = 3;

export const StructMemCrossSessionDistillationOutputSchema = z.object({
  stable_items: z
    .array(StructMemCrossSessionItemSchema)
    .default([])
    .transform((items) =>
      items.length <= MAX_CROSS_SESSION_STABLE_ITEMS
        ? items
        : [...items]
            .sort((a, b) => b.importance_score - a.importance_score)
            .slice(0, MAX_CROSS_SESSION_STABLE_ITEMS),
    ),
});

export type StructMemCrossSessionItem = z.infer<
  typeof StructMemCrossSessionItemSchema
>;

export type StructMemCrossSessionDistillationOutput = z.infer<
  typeof StructMemCrossSessionDistillationOutputSchema
>;

export function parseStructMemConsolidationOutput(
  raw: unknown,
): StructMemConsolidationOutput {
  return StructMemConsolidationOutputSchema.parse(raw);
}

function trimToBudget(text: string, maxTokens: number): string {
  const maxChars = Math.max(1000, maxTokens * 4);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function formatEntries(
  title: string,
  entries: ConsolidationCandidateEntry[],
): string {
  if (entries.length === 0) return `${title}\n(none)`;
  return `${title}\n${entries
    .map(
      (e) =>
        `- [entry:${e.id}] [event:${e.eventId}] [turn:${e.turnIndex}] [type:${e.entryType}] ${e.text}`,
    )
    .join("\n")}`;
}

export function buildStructMemConsolidationPrompt(input: {
  bufferEntries: ConsolidationCandidateEntry[];
  semanticSeedEntries: ConsolidationCandidateEntry[];
  maxInputTokens: number;
}): string {
  const body = [
    "将当前会话中的 StructMem 条目综合为一条紧凑的记忆整合结果。",
    "保持输出紧凑——summary_text 要简短, summary_json 要精简。",
    "只能使用提供的条目。不要编造人物、行为、动机、日期或结果。",
    "优先保留会话内较持久的模式、未解决的线索、决策、事实状态，以及关系/情绪变化。",
    "如果 buffer entries 与 semantic seeds 发生冲突，优先采用 buffer entries。",
    "只返回包含 summary_text、summary_json 和 confidence_score 的 JSON。",
    "示例结构（请替换为真实内容）：",
    '{"summary_text":"一段紧凑的总结。","summary_json":{},"confidence_score":0.75}',
    "",
    formatEntries("BUFFER ENTRIES", input.bufferEntries),
    "",
    formatEntries("SEMANTIC SEED ENTRIES", input.semanticSeedEntries),
  ].join("\n");
  return trimToBudget(body, input.maxInputTokens);
}

async function synthesizeStructMemConsolidationImpl(input: {
  bufferEntries: ConsolidationCandidateEntry[];
  semanticSeedEntries: ConsolidationCandidateEntry[];
  maxInputTokens: number;
}): Promise<StructMemConsolidationSynthesisResult> {
  const prompt = buildStructMemConsolidationPrompt(input);
  const systemStrictJson =
    "你是一个保守的记忆整合工作器。" +
    "保持输出紧凑——summary_text 要简短, summary_json 要精简。" +
    "只返回一个 JSON 对象（不要使用 markdown 代码块，不要添加前言）。" +
    '字段包括: "summary_text"（字符串）, "summary_json"（对象）, "confidence_score" (0 到 1 之间的数字，或 null)。';

  const runChat = () =>
    chatJsonWithFallback(
      models.consolidation,
      models.fallbacks.structMemConsolidation,
      [
        { role: "system", content: systemStrictJson },
        { role: "user", content: prompt },
      ],
      StructMemConsolidationOutputSchema,
      { maxTokens: 1600, temperature: 0.1 },
    );

  let result = await runChat();

  if (!result.ok) {
    const preview = result.raw.trim().slice(0, 280);
    const repairPrompt = [
      prompt,
      "",
      `上一次模型输出无法被解析（${result.error}）。`,
      "请让输出比上一次尝试更短、更简单。只返回一个紧凑的 JSON 对象。",
      "所有键和字符串值都使用 ASCII 双引号。",
      '必需字段："summary_text"、"summary_json"、"confidence_score"。',
      preview ? `Bad output began with: ${preview}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    result = await chatJsonWithFallback(
      models.consolidation,
      models.fallbacks.structMemConsolidation,
      [
        { role: "system", content: systemStrictJson },
        { role: "user", content: repairPrompt },
      ],
      StructMemConsolidationOutputSchema,
      { maxTokens: 1600, temperature: 0 },
    );
  }

  if (!result.ok) {
    const tail = result.raw.trim().slice(-400);
    throw new Error(
      `StructMem consolidation parse failed: ${result.error}; rawHead=${JSON.stringify(
        result.raw.trim().slice(0, 400),
      )}; rawTail=${JSON.stringify(tail)}`,
    );
  }

  const data = result.data;
  return attachTraceLlmMetadata(
    {
      summary_text: data.summary_text,
      summary_json: data.summary_json ?? {},
      confidence_score: data.confidence_score ?? null,
      telemetry: {
        model: result.binding.model,
        provider: result.binding.provider,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    },
    {
      binding: result.binding,
      modelRole: "consolidation",
      usage: result,
      fallback: {
        used: result.fallbackUsed,
        attempts: result.fallbackAttempts,
      },
    },
  );
}

export const synthesizeStructMemConsolidation = traceLLMStage(
  "llm.structmem_consolidation",
  synthesizeStructMemConsolidationImpl,
  {
    subsystem: "llm",
    turn: "background",
    llm: { binding: models.consolidation, modelRole: "consolidation" },
    getUsage: (outputs) => {
      const telemetry = (outputs as { telemetry?: unknown })?.telemetry;
      if (!telemetry || typeof telemetry !== "object") return undefined;
      const usage = telemetry as {
        inputTokens?: unknown;
        outputTokens?: unknown;
      };
      if (
        typeof usage.inputTokens !== "number" ||
        typeof usage.outputTokens !== "number"
      ) {
        return undefined;
      }
      return {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      };
    },
  },
);

function buildCrossSessionDistillationPrompt(input: {
  summaryText: string;
  summaryJson: Record<string, unknown>;
  confidenceScore: number | null;
}): string {
  return [
    "判断当前会话的 StructMem 综合结果是否包含稳定的跨会话记忆。",
    "只返回那些应当有助于同一记忆命名空间下未来会话的条目。",
    "不要包含一次性场景细节、短暂情绪，或缺乏依据的推测。",
    "stable_items 最多包含 3 条。如果稳定的候选超过 3 条，只保留最重要的 3 条。",
    "如果没有足够稳定的内容，则返回一个空的 stable_items 数组。",
    "",
    `Current confidence: ${input.confidenceScore ?? "unknown"}`,
    `Summary: ${input.summaryText}`,
    `Structured JSON: ${JSON.stringify(input.summaryJson ?? {})}`,
    "",
    "Return JSON only: { stable_items: [{ category, summary_text, confidence_score, importance_score, tags }] }.",
    'Example: {"stable_items":[{"category":"promise_or_commitment","summary_text":"...","confidence_score":0.8,"importance_score":0.75,"tags":[]}]}',
  ].join("\n");
}

async function distillCrossSessionStructMemImpl(input: {
  summaryText: string;
  summaryJson: Record<string, unknown>;
  confidenceScore: number | null;
}): Promise<StructMemCrossSessionDistillationOutput> {
  const userContent = buildCrossSessionDistillationPrompt(input);
  const systemDistill =
    "你是一个保守的记忆提炼工作器。" +
    "只返回一个 JSON 对象（不要使用 markdown)。字段包括: stable_items (数组，至多 3 条)。";

  const runChat = () =>
    chatJsonWithFallback(
      models.consolidation,
      models.fallbacks.structMemCrossSessionDistillation,
      [
        { role: "system", content: systemDistill },
        { role: "user", content: userContent },
      ],
      StructMemCrossSessionDistillationOutputSchema,
      { maxTokens: 700, temperature: 0.1 },
    );

  let result = await runChat();

  if (!result.ok) {
    const repairUser = [
      userContent,
      "",
      `Previous output was not valid JSON (${result.error}). Reply with ONLY: {"stable_items":[...] } using double quotes.`,
    ].join("\n");
    result = await chatJsonWithFallback(
      models.consolidation,
      models.fallbacks.structMemCrossSessionDistillation,
      [
        { role: "system", content: systemDistill },
        { role: "user", content: repairUser },
      ],
      StructMemCrossSessionDistillationOutputSchema,
      { maxTokens: 700, temperature: 0 },
    );
  }

  if (!result.ok) {
    throw new Error(
      `StructMem cross-session distillation failed: ${result.error}; rawPreview=${JSON.stringify(
        result.raw.trim().slice(0, 500),
      )}`,
    );
  }

  return attachTraceLlmMetadata(
    StructMemCrossSessionDistillationOutputSchema.parse(result.data),
    {
      binding: result.binding,
      modelRole: "consolidation",
      usage: result,
      fallback: {
        used: result.fallbackUsed,
        attempts: result.fallbackAttempts,
      },
    },
  );
}

export const distillCrossSessionStructMem = traceLLMStage(
  "llm.structmem_cross_session_distillation",
  distillCrossSessionStructMemImpl,
  {
    subsystem: "llm",
    turn: "background",
    llm: { binding: models.consolidation, modelRole: "consolidation" },
  },
);

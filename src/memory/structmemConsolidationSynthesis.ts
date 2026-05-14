import { z } from "zod";
import { models } from "../config/models";
import { chatJson } from "../llm/providers";
import { traceLLMStage } from "../observability/langsmithTracing";
import type { ConsolidationCandidateEntry } from "./structmemConsolidationSelection";

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
    "Synthesize current-session StructMem entries into one compact memory consolidation.",
    "Use only the provided entries. Do not invent people, actions, motives, dates, or outcomes.",
    "Prefer durable within-session patterns, unresolved threads, decisions, factual state, and relationship/emotional movement.",
    "If buffer entries conflict with semantic seeds, prefer buffer entries.",
    "Return JSON only with summary_text, summary_json, and confidence_score.",
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
  const result = await chatJson(
    models.consolidation,
    [
      {
        role: "system",
        content:
          "You are a conservative memory consolidation worker. Output strictly valid JSON.",
      },
      { role: "user", content: prompt },
    ],
    StructMemConsolidationOutputSchema,
    { maxTokens: 900, temperature: 0.1 },
  );

  if (!result.ok) {
    throw new Error(`StructMem consolidation parse failed: ${result.error}`);
  }

  const data = result.data;
  return {
    summary_text: data.summary_text,
    summary_json: data.summary_json ?? {},
    confidence_score: data.confidence_score ?? null,
    telemetry: {
      model: models.consolidation.model,
      provider: models.consolidation.provider,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
  };
}

export const synthesizeStructMemConsolidation = traceLLMStage(
  "llm.structmem_consolidation",
  synthesizeStructMemConsolidationImpl,
  { tags: ["structmem", "phase3"] },
);

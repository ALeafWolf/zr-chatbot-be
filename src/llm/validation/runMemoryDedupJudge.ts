import { z } from "zod";
import { models } from "../../config/models";
import { chatJsonStreamWithFallback } from "../providers";
import { traceLLMStage } from "../../observability/langsmithTracing";
import { attachTraceLlmMetadata } from "../../observability/traceMetadata";

export type MemoryDedupJudgeDecision =
  | "same"
  | "superseding_update"
  | "distinct";

export interface MemoryDedupJudgeResult {
  decision: MemoryDedupJudgeDecision;
  matchingCandidateId?: string;
  usedFailOpen: boolean;
}

const MemoryDedupJudgeSchema = z.object({
  decision: z.enum(["same", "superseding_update", "distinct"]),
  matchingCandidateId: z.string().optional(),
});

const MEMORY_DEDUP_JUDGE_SYSTEM = `You are a durable memory deduplication judge.
Compare a new memory with existing candidate memories.
Return "same" only when it records the same durable fact.
Return "superseding_update" when the new memory clearly updates or replaces an existing fact.
Return "distinct" when both memories should coexist.
Return ONLY valid JSON: {"decision":"same|superseding_update|distinct","matchingCandidateId":"optional id"}.`;

async function memoryDedupJudgeCore(input: {
  newMemorySummary: string;
  candidates: Array<{ id: string; summary: string }>;
  signal?: AbortSignal;
}): Promise<MemoryDedupJudgeResult> {
  const user = `
New memory:
"""
${input.newMemorySummary.trim().slice(0, 1200)}
"""

Existing candidates:
${input.candidates
  .slice(0, 3)
  .map(
    (candidate, index) =>
      `${index + 1}. id=${candidate.id}\n"""${candidate.summary
        .trim()
        .slice(0, 1000)}"""`,
  )
  .join("\n\n")}

Return the JSON object.`.trim();

  const res = await chatJsonStreamWithFallback(
    models.validator,
    models.fallbacks.memoryDedupJudge,
    [
      { role: "system", content: MEMORY_DEDUP_JUDGE_SYSTEM },
      { role: "user", content: user },
    ],
    MemoryDedupJudgeSchema,
    { maxTokens: 256, temperature: 0.1, signal: input.signal },
  );

  if (!res.ok) {
    return attachTraceLlmMetadata(
      { decision: "distinct", usedFailOpen: true },
      {
        binding: res.binding,
        modelRole: "memoryDedupJudge",
        usage: res,
      },
    );
  }

  return attachTraceLlmMetadata(
    {
      decision: res.data.decision,
      matchingCandidateId: res.data.matchingCandidateId,
      usedFailOpen: false,
    },
    {
      binding: res.binding,
      modelRole: "memoryDedupJudge",
      usage: res,
    },
  );
}

export const runMemoryDedupJudge = traceLLMStage("llm.run_memory_dedup_judge", memoryDedupJudgeCore, {
  subsystem: "llm",
  turn: "background",
  llm: { binding: models.validator, modelRole: "memoryDedupJudge" },
  processInputs: (inputs: Readonly<Record<string, unknown>>) => ({
    new_memory_chars:
      typeof inputs.newMemorySummary === "string"
        ? inputs.newMemorySummary.length
        : 0,
    candidate_count: Array.isArray(inputs.candidates)
      ? inputs.candidates.length
      : 0,
  }),
  processOutputs: (outputs: Readonly<Record<string, unknown>>) => {
    const result = outputs as unknown as MemoryDedupJudgeResult;
    return {
      decision: result.decision,
      matched: Boolean(result.matchingCandidateId),
      used_fail_open: result.usedFailOpen,
    };
  },
}) as (input: {
  newMemorySummary: string;
  candidates: Array<{ id: string; summary: string }>;
  signal?: AbortSignal;
}) => Promise<MemoryDedupJudgeResult>;

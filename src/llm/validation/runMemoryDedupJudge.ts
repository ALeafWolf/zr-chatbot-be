import { z } from "zod";
import { traceable } from "langsmith/traceable";
import { env } from "../../config/env";
import { models } from "../../config/models";
import { chatJsonStream } from "../providers";

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

  const res = await chatJsonStream(
    models.validator,
    [
      { role: "system", content: MEMORY_DEDUP_JUDGE_SYSTEM },
      { role: "user", content: user },
    ],
    MemoryDedupJudgeSchema,
    { maxTokens: 256, temperature: 0.1, signal: input.signal },
  );

  if (!res.ok) {
    return { decision: "distinct", usedFailOpen: true };
  }

  return {
    decision: res.data.decision,
    matchingCandidateId: res.data.matchingCandidateId,
    usedFailOpen: false,
  };
}

export const runMemoryDedupJudge = traceable(memoryDedupJudgeCore, {
  name: "llm.run_memory_dedup_judge",
  run_type: "llm",
  project_name: env.LANGSMITH_PROJECT,
  tags: ["phase1", "llm", "retrieval", "dedup"],
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

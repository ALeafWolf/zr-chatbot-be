import { z } from "zod";
import { models } from "../config/models";
import { env } from "../config/env";
import { chatJsonStream } from "../llm/providers";
import { traceLLMStage } from "../observability/langsmithTracing";
import type { ContextCandidate, ContextCandidateSource } from "./contextCandidates";
import type { ContextPlannerOutput } from "./contextPlanner";
import { buildMemoryRerankPrompt } from "./memoryRerankPrompt";

const RelevanceSchema = z.enum([
  "required",
  "useful",
  "subtle_tone_only",
  "background_only",
]);

const UsageInstructionSchema = z.enum([
  "must_use",
  "use_subtly",
  "do_not_mention_explicitly",
  "tone_only",
]);

const RERANKER_CATEGORIES = [
  "may_derail_scene",
  "possible_conflict",
  "too_old",
  "low_confidence",
  "irrelevant_to_current_turn",
  "too_broad",
  "conflicts_with_recent_chat",
  "canon_not_needed",
  "memory_not_needed",
  "duplicate",
  "unsafe_to_use",
] as const;

const RerankerCategorySchema = z.enum(RERANKER_CATEGORIES);

/** Accepts model "no risk" variants and normalizes them to undefined. */
const OptionalRiskSchema = z.preprocess(
  (value) =>
    value === null || (typeof value === "string" && value.trim() === "")
      ? undefined
      : value,
  RerankerCategorySchema.optional(),
);

const RejectReasonSchema = RerankerCategorySchema;

const FinalContextModeSchema = z.enum([
  "recent_only",
  "selected_memory",
  "selected_canon",
  "memory_and_canon",
  "no_extra_context",
]);

const RerankOutputSchema = z.object({
  selected: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      relevance: RelevanceSchema,
      usageInstruction: UsageInstructionSchema,
      reason: z.string(),
      risk: OptionalRiskSchema,
    }),
  ),
  rejected: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      reason: RejectReasonSchema,
    }),
  ),
  finalContextMode: FinalContextModeSchema,
  needsEvidenceFallback: z.boolean(),
  missingEvidence: z.array(z.string()).optional(),
});

export type MemoryRerankInput = {
  currentUserMessage: string;
  structuredUserQuery: ContextPlannerOutput["structuredUserQuery"];
  plannerIntent: ContextPlannerOutput["intent"];
  plannerHints: ContextPlannerOutput["retrievalHints"];
  recentChatDigest: string;
  latestTurnDelta?: string;
  relationshipState: string;
  continuityScope: string;
  candidates: ContextCandidate[];
};

export type MemoryRerankSelected = {
  id: string;
  source: ContextCandidateSource;
  relevance: z.infer<typeof RelevanceSchema>;
  usageInstruction: z.infer<typeof UsageInstructionSchema>;
  reason: string;
  risk?: z.infer<typeof RerankerCategorySchema>;
};

export type MemoryRerankRejected = {
  id: string;
  source: ContextCandidateSource;
  reason: z.infer<typeof RejectReasonSchema>;
};

export type MemoryRerankOutput = {
  selected: MemoryRerankSelected[];
  rejected: MemoryRerankRejected[];
  finalContextMode: z.infer<typeof FinalContextModeSchema>;
  needsEvidenceFallback: boolean;
  missingEvidence?: string[];
};

export type MemoryRerankResult =
  | { ok: true; output: MemoryRerankOutput; inputTokens: number; outputTokens: number }
  | { ok: false; fallbackReason: string };

const EMPTY_RERANK: MemoryRerankOutput = {
  selected: [],
  rejected: [],
  finalContextMode: "recent_only",
  needsEvidenceFallback: false,
};

function validateSelected(
  selected: MemoryRerankOutput["selected"],
  candidates: ContextCandidate[],
  maxSelected: number,
): MemoryRerankOutput["selected"] {
  const candidateIds = new Set(candidates.map((c) => c.id));
  return selected
    .filter((s) => candidateIds.has(s.id))
    .slice(0, maxSelected);
}

function applyEmptySelectionGuard(
  output: MemoryRerankOutput,
  candidates: ContextCandidate[],
  plannerIntent: ContextPlannerOutput["intent"],
): MemoryRerankOutput {
  const needsGuard =
    output.selected.length === 0 &&
    (plannerIntent === "explicit_recall" ||
      plannerIntent === "canon_question" ||
      plannerIntent === "implicit_memory_callback");

  if (!needsGuard) return output;

  const best = candidates
    .filter((c) =>
      plannerIntent === "canon_question"
        ? c.source === "canon_chunk"
        : c.source !== "canon_chunk",
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];

  if (!best) return output;

  return {
    ...output,
    selected: [
      {
        id: best.id,
        source: best.source,
        relevance: "required",
        usageInstruction: "must_use",
        reason: "rerank_empty_guard_applied",
      },
    ],
  };
}

const tracedRerank = traceLLMStage(
  "llm.memory_rerank",
  async (input: MemoryRerankInput): Promise<MemoryRerankResult> => {
    const candidateIds = new Set(input.candidates.map((c) => c.id));

    const prompt = buildMemoryRerankPrompt({
      currentUserMessage: input.currentUserMessage,
      plannerIntent: input.plannerIntent,
      candidates: input.candidates,
      maxSelected: env.MEMORY_RERANK_MAX_SELECTED,
    });

    const messages = [
      { role: "system" as const, content: prompt.system },
      { role: "user" as const, content: prompt.user },
    ];

    const result = await chatJsonStream(
      models.rerank,
      messages,
      RerankOutputSchema,
      { maxTokens: 4096, temperature: 0.3, signal: new AbortController().signal },
    );

    if (!result.ok) {
      return { ok: false, fallbackReason: `rerank_llm_failed: ${result.error}` };
    }

    const validated = result.data;
    let selected = validateSelected(
      validated.selected.map((s) => ({
        ...s,
        source: s.source as ContextCandidateSource,
      })),
      input.candidates,
      env.MEMORY_RERANK_MAX_SELECTED,
    );

    const rejected: MemoryRerankRejected[] = validated.rejected
      .filter((r) => candidateIds.has(r.id))
      .map((r) => ({
        id: r.id,
        source: r.source as ContextCandidateSource,
        reason: r.reason,
      }));

    const raw = applyEmptySelectionGuard(
      { ...validated, selected, rejected },
      input.candidates,
      input.plannerIntent,
    );

    return {
      ok: true,
      output: raw,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  },
  {
    subsystem: "llm",
    turn: "foreground",
    llm: { binding: models.rerank, modelRole: "memory_rerank" },
  },
);

/** Exported for unit testing: the Zod schema that the LLM output must match. */
export const __testing = {
  RerankOutputSchema,
  RERANKER_CATEGORIES,
  RerankerCategorySchema,
  OptionalRiskSchema,
};

/** Apply LLM usage metadata to a traceable, then run the reranker. */
export async function rerankCandidates(
  input: MemoryRerankInput,
): Promise<MemoryRerankResult> {
  try {
    const result = await Promise.race([
      tracedRerank(input),
      new Promise<MemoryRerankResult>((resolve) =>
        setTimeout(
          () => resolve({ ok: false, fallbackReason: "timeout" }),
          5000,
        ),
      ),
    ]);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, fallbackReason: `exception: ${msg}` };
  }
}

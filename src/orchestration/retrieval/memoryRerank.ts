import { z } from "zod";
import { models, type ModelBinding } from "../../config/models";
import { env } from "../../config/env";
import { chatJson } from "../../llm/providers";
import { traceLLMStage } from "../../observability/langsmithTracing";
import type { ContextCandidate, ContextCandidateSource } from "../context/contextCandidates";
import type { ContextPlannerOutput } from "../context/contextPlanner";
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

const SELECTED_REASON_CODES = [
  "direct_continuity",
  "explicit_recall",
  "relationship_motif",
  "open_thread",
  "canon_required",
  "conflict_avoidance",
  "tone_guidance",
  "user_preference",
  "pending_commitment",
  "safety_boundary",
] as const;

const REJECTED_REASON_CODES = [
  "irrelevant",
  "too_broad",
  "duplicate",
  "conflicts_recent",
  "too_old",
  "low_confidence",
  "canon_not_needed",
  "memory_not_needed",
  "unsafe",
] as const;

const SelectedReasonCodeSchema = z.enum(SELECTED_REASON_CODES);
const RejectedReasonCodeSchema = z.enum(REJECTED_REASON_CODES);

const FinalContextModeSchema = z.enum([
  "recent_only",
  "selected_memory",
  "selected_canon",
  "memory_and_canon",
  "no_extra_context",
]);

/** Permissive schema: accepts `id` as `string | number` for compact selected items. */
const CompactRawSelectedSchema = z.object({
  id: z.union([z.string(), z.number()]),
  relevance: RelevanceSchema,
  usageInstruction: UsageInstructionSchema,
  reasonCode: SelectedReasonCodeSchema,
});

/** Permissive schema: accepts `id` as `string | number` for compact rejected items. */
const CompactRawRejectedSchema = z.object({
  id: z.union([z.string(), z.number()]),
  reasonCode: RejectedReasonCodeSchema,
});

const CompactRawRerankOutputSchema = z.object({
  selected: z.array(CompactRawSelectedSchema),
  rejected: z.array(CompactRawRejectedSchema),
  finalContextMode: FinalContextModeSchema,
  needsEvidenceFallback: z.boolean(),
  missingEvidence: z.array(z.string()).optional(),
});

/** Strict schema — enforces `id: string`. Used after normalization. */
const RerankOutputSchema = z.object({
  selected: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      relevance: RelevanceSchema,
      usageInstruction: UsageInstructionSchema,
      reasonCode: SelectedReasonCodeSchema,
    }),
  ),
  rejected: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      reasonCode: RejectedReasonCodeSchema,
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
  /** Optional AbortSignal to cancel the in-flight LLM request. */
  signal?: AbortSignal;
};

export type MemoryRerankSelected = {
  id: string;
  source: ContextCandidateSource;
  relevance: z.infer<typeof RelevanceSchema>;
  usageInstruction: z.infer<typeof UsageInstructionSchema>;
  reasonCode: z.infer<typeof SelectedReasonCodeSchema>;
};

export type MemoryRerankRejected = {
  id: string;
  source: ContextCandidateSource;
  reasonCode: z.infer<typeof RejectedReasonCodeSchema>;
};

export type MemoryRerankOutput = {
  selected: MemoryRerankSelected[];
  rejected: MemoryRerankRejected[];
  /** @diagnostic — emitted to traces but no behavior is driven by this value yet. */
  finalContextMode: z.infer<typeof FinalContextModeSchema>;
  /** @diagnostic — emitted to traces but no behavior is driven by this value yet. */
  needsEvidenceFallback: boolean;
  /** @diagnostic — emitted to traces but no behavior is driven by this value yet. */
  missingEvidence?: string[];
  /** How candidate IDs from the raw LLM output were resolved. */
  resolutionDiagnostics?: {
    /** Count of IDs that matched a candidate by exact string ID. */
    exactIdCount: number;
    /** Count of IDs that resolved via zero-based candidate index. */
    numericIndexCount: number;
    /** Count of IDs that could not be matched to any candidate. */
    unresolvedCount: number;
  };
};

export type MemoryRerankResult =
  | { ok: true; output: MemoryRerankOutput; inputTokens: number; outputTokens: number; timingMs: number }
  | { ok: false; fallbackReason: string; timingMs: number; rerankDiagnostics?: RerankFailureDiagnostics };

export interface RerankFailureDiagnostics {
  error: string;
  /** Safe bounded preview of raw model output (control chars stripped, truncated). */
  rawPreview: string;
  /** Full length of raw model output in characters. */
  rawLength: number;
  finishReason?: string | null;
  inputTokens: number;
  outputTokens: number;
  /** Distinguishes non-streaming transport from streaming for diagnostics. */
  transportMode?: "non_streaming";
}

const EMPTY_RERANK: MemoryRerankOutput = {
  selected: [],
  rejected: [],
  finalContextMode: "recent_only",
  needsEvidenceFallback: false,
};

/**
 * Resolve a raw (possibly numeric) reranker ID to a known candidate.
 *
 * - String candidates: exact match by candidate ID first; if no match and the
 *   string is a valid integer index, resolve by position.
 * - Numeric candidates: resolve by zero-based index into the candidate list.
 * - Out-of-range, non-integer, or unresolvable values return `null`.
 */
export function resolveCandidate(
  id: string | number,
  candidates: ContextCandidate[],
): ContextCandidate | null {
  if (typeof id === "string") {
    const exact = candidates.find((c) => c.id === id);
    if (exact) return exact;
    const n = Number(id);
    if (Number.isInteger(n) && n >= 0 && n < candidates.length) {
      return candidates[n];
    }
    return null;
  }
  if (Number.isInteger(id) && id >= 0 && id < candidates.length) {
    return candidates[id];
  }
  return null;
}

/** Normalize raw selected items: resolve ID, use candidate source, drop unknowns. */
export function normalizeSelected(
  raw: z.infer<typeof CompactRawSelectedSchema>[],
  candidates: ContextCandidate[],
): MemoryRerankSelected[] {
  const out: MemoryRerankSelected[] = [];
  for (const item of raw) {
    const candidate = resolveCandidate(item.id, candidates);
    if (!candidate) continue;
    out.push({
      id: candidate.id,
      source: candidate.source,
      relevance: item.relevance,
      usageInstruction: item.usageInstruction,
      reasonCode: item.reasonCode,
    });
  }
  return out;
}

/** Normalize raw rejected items: resolve ID, use candidate source, drop unknowns. */
export function normalizeRejected(
  raw: z.infer<typeof CompactRawRejectedSchema>[],
  candidates: ContextCandidate[],
): MemoryRerankRejected[] {
  const out: MemoryRerankRejected[] = [];
  for (const item of raw) {
    const candidate = resolveCandidate(item.id, candidates);
    if (!candidate) continue;
    out.push({
      id: candidate.id,
      source: candidate.source,
      reasonCode: item.reasonCode,
    });
  }
  return out;
}

/**
 * Count how raw LLM-output IDs resolved against known candidates.
 *
 * - exactIdCount: string IDs that matched a candidate by exact string equality.
 * - numericIndexCount: numeric IDs (or parseable numeric strings) that resolved
 *   via zero-based candidate-list index.
 * - unresolvedCount: IDs that could not be matched to any candidate.
 */
export function countIdResolutionModes(
  rawItems: { id: string | number }[],
  candidates: ContextCandidate[],
): { exactIdCount: number; numericIndexCount: number; unresolvedCount: number } {
  let exactIdCount = 0;
  let numericIndexCount = 0;
  let unresolvedCount = 0;
  for (const item of rawItems) {
    const resolved = resolveCandidate(item.id, candidates);
    if (!resolved) {
      unresolvedCount++;
    } else if (typeof item.id === "string" && candidates.some((c) => c.id === item.id)) {
      exactIdCount++;
    } else {
      numericIndexCount++;
    }
  }
  return { exactIdCount, numericIndexCount, unresolvedCount };
}

/**
 * Return OpenAI-compatible request extensions for the rerank model binding.
 * For DeepSeek, disables hidden reasoning/thinking tokens that consume the
 * output budget before the compact JSON object closes.
 */
export function rerankRequestExtensions(
  binding: ModelBinding,
): Record<string, unknown> | undefined {
  if (binding.provider === "deepseek") {
    return { thinking: { type: "disabled" } };
  }
  return undefined;
}

const RAW_PREVIEW_MAX_LEN = 200;

/**
 * Normalize control characters (except newlines) and truncate to a bounded cap.
 * Safe for traces — never includes unbounded raw model output.
 */
export function safeRawPreview(raw: string, maxLen = RAW_PREVIEW_MAX_LEN): string {
  const cleaned = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen) + "...";
}

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
        ? c.source === "canon_chunk" || c.source === "canon_fact"
        : c.source !== "canon_chunk" && c.source !== "canon_fact",
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
        reasonCode: "direct_continuity",
      },
    ],
  };
}

const tracedRerank = traceLLMStage(
  "llm.memory_rerank",
  async (input: MemoryRerankInput): Promise<MemoryRerankResult> => {
      const startedAt = Date.now();
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

    // Parse with non-streaming chatJson (rerank only needs one compact JSON object).
    const result = await chatJson(
      models.rerank,
      messages,
      CompactRawRerankOutputSchema,
      {
        maxTokens: 4096,
        temperature: 0.3,
        signal: input.signal ?? new AbortController().signal,
        openAICompatibleRequestExtensions: rerankRequestExtensions(models.rerank),
      },
    );

    if (!result.ok) {
      return {
        ok: false,
        fallbackReason: `rerank_llm_failed: ${result.error}`,
        timingMs: Date.now() - startedAt,
        rerankDiagnostics: {
          error: result.error,
          rawPreview: safeRawPreview(result.raw),
          rawLength: result.raw.length,
          finishReason: result.finishReason,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          transportMode: "non_streaming",
        },
      };
    }

    const raw = result.data;
    const selected = normalizeSelected(raw.selected, input.candidates);
    const rejected = normalizeRejected(raw.rejected, input.candidates);
    const rerankTimingMs = Date.now() - startedAt;

    // Count how raw IDs resolved: exact string match, numeric index, or unresolved
    const selModes = countIdResolutionModes(raw.selected, input.candidates);
    const rejModes = countIdResolutionModes(raw.rejected, input.candidates);
    const exactIdCount = selModes.exactIdCount + rejModes.exactIdCount;
    const numericIndexCount = selModes.numericIndexCount + rejModes.numericIndexCount;
    const unresolvedCount = selModes.unresolvedCount + rejModes.unresolvedCount;

    let cappedSelected = validateSelected(
      selected,
      input.candidates,
      env.MEMORY_RERANK_MAX_SELECTED,
    );

    const guarded = applyEmptySelectionGuard(
      {
        selected: cappedSelected,
        rejected,
        finalContextMode: raw.finalContextMode,
        needsEvidenceFallback: raw.needsEvidenceFallback,
        missingEvidence: raw.missingEvidence,
      },
      input.candidates,
      input.plannerIntent,
    );

    guarded.resolutionDiagnostics = { exactIdCount, numericIndexCount, unresolvedCount };

    return {
      ok: true,
      output: guarded,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      timingMs: rerankTimingMs,
    };
  },
  {
    subsystem: "llm",
    turn: "foreground",
    llm: { binding: models.rerank, modelRole: "memory_rerank" },
  },
);

/** Exported for unit testing: schemas, normalization helpers, and timeout helper. */
export const __testing = {
  RerankOutputSchema,
  CompactRawRerankOutputSchema,
  SELECTED_REASON_CODES,
  REJECTED_REASON_CODES,
  SelectedReasonCodeSchema,
  RejectedReasonCodeSchema,
  resolveCandidate,
  normalizeSelected,
  normalizeRejected,
  validateSelected,
  applyEmptySelectionGuard,
  rerankRequestExtensions,
  createRerankTimeout,
  safeRawPreview,
  countIdResolutionModes,
};

/**
 * Create a cancellable rerank timeout with an AbortController.
 *
 * The returned promise resolves with a timeout-specific fallback reason
 * after `timeoutMs`. Call `cancel()` to clear the timer when rerank
 * completes before the deadline.
 */
export interface RerankTimeout {
  promise: Promise<MemoryRerankResult>;
  controller: AbortController;
  cancel: () => void;
}

export function createRerankTimeout(timeoutMs: number): RerankTimeout {
  const controller = new AbortController();
  let timerId: ReturnType<typeof setTimeout> | undefined;

  const promise = new Promise<MemoryRerankResult>((resolve) => {
    timerId = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, fallbackReason: `timeout_after_${timeoutMs}ms`, timingMs: timeoutMs });
    }, timeoutMs);
  });

  return {
    promise,
    controller,
    cancel: () => {
      if (timerId !== undefined) {
        clearTimeout(timerId);
        timerId = undefined;
      }
    },
  };
}

/** Apply LLM usage metadata to a traceable, then run the reranker. */
export async function rerankCandidates(
  input: MemoryRerankInput,
): Promise<MemoryRerankResult> {
  const timeoutMs = env.MEMORY_RERANK_TIMEOUT_MS;
  const { promise: timeoutPromise, controller, cancel } = createRerankTimeout(timeoutMs);

  try {
    const result = await Promise.race([
      tracedRerank({ ...input, signal: controller.signal }).catch((err) => {
        // Suppress post-race rejection caused by abort after timeout
        if (controller.signal.aborted) {
          return { ok: false as const, fallbackReason: "suppressed_after_timeout" as const, timingMs: 0 };
        }
        throw err;
      }),
      timeoutPromise,
    ]);
    cancel(); // Clear timer when rerank completes before deadline
    return result;
  } catch (e) {
    cancel();
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, fallbackReason: `exception: ${msg}`, timingMs: 0 };
  }
}

import * as z from "zod";
import type { PostTurnJobPayloadV1, PostTurnStepName, PostTurnStepStatus } from "../../jobs/postTurnJobPayload";
import type { PostTurnSignals } from "../../llm/extraction/extractPostTurnSignals";
import type { PostTurnWritePlan } from "../../jobs/postTurnPolicies";
import type { ChatSession } from "../../db/schema/chat";

// ---------------------------------------------------------------------------
// Retry-reason enum
// ---------------------------------------------------------------------------

export const RETRY_REASON_VALUES = [
  "extractor_timeout",
  "extract_json_parse",
  "db_write_conflict",
  "consolidation_enqueue_failed",
] as const;

export type PostTurnRetryReason = (typeof RETRY_REASON_VALUES)[number];

// ---------------------------------------------------------------------------
// Input state — set before graph invocation
// ---------------------------------------------------------------------------

export interface PostTurnGraphStateInput {
  jobId: string;
  attempts: number;
  payload: PostTurnJobPayloadV1;
  stepStatus: PostTurnStepStatus;
}

// ---------------------------------------------------------------------------
// Full runtime state — includes derived fields and accumulators
// ---------------------------------------------------------------------------

export interface PostTurnGraphStateRuntime extends PostTurnGraphStateInput {
  /** Derived once from payload.session. */
  session: ChatSession;
  /** Derived once from payload.recentMemorySummaries. */
  recentMemoriesStr: string;

  // --- populated as graph runs ---

  /** Extracted signals (either from payload.signals or freshly extracted). */
  signals?: PostTurnSignals;
  /** Write plan built from signals + session + env. */
  writePlan?: PostTurnWritePlan;
  /** Whether structmem consolidation was enqueued on this pass. */
  consolidationEnqueued?: boolean;
  /** Steps completed so far on this graph invocation. */
  completedSteps: PostTurnStepName[];

  // --- failure-mode metadata (populated only when retryable failure detected) ---

  lastRetryReason?: PostTurnRetryReason;

  // --- error accumulator ---

  errors?: Array<{
    stage: string;
    message: string;
  }>;
}

export interface PostTurnGraphStateError {
  stage: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Defaults for runtime-only fields (used when constructing initial state)
// ---------------------------------------------------------------------------

export function createInitialPostTurnRuntimeState(
  input: PostTurnGraphStateInput,
  session: ChatSession,
  recentMemoriesStr: string,
): PostTurnGraphStateRuntime {
  return {
    ...input,
    session,
    recentMemoriesStr,
    completedSteps: [],
  };
}

// ---------------------------------------------------------------------------
// Zod schema for the graph state
// ---------------------------------------------------------------------------

const PostTurnStepNameSchema = z.enum([
  "raw_chunk",
  "extract_signals",
  "structmem",
  "session_chunks",
  "durable_memory",
  "summary_compact",
]);

const PostTurnStepStateSchema = z.enum(["pending", "completed", "failed"]);

const PostTurnStepStatusSchema = z.object({
  raw_chunk: PostTurnStepStateSchema,
  extract_signals: PostTurnStepStateSchema,
  structmem: PostTurnStepStateSchema,
  session_chunks: PostTurnStepStateSchema,
  durable_memory: PostTurnStepStateSchema,
  summary_compact: PostTurnStepStateSchema,
});

const PostTurnRetryReasonSchema = z.enum(RETRY_REASON_VALUES);

/**
 * Zod schema for the post-turn memory graph state.
 *
 * LangGraph v1 accepts Zod schemas directly as state definitions with `StateGraph`.
 * Complex domain types use `z.any()` to avoid tight Zod coupling; the TypeScript
 * interface provides full type safety for node implementations.
 */
export const PostTurnGraphStateSchema = z.object({
  // Provided as input.
  jobId: z.string(),
  attempts: z.number().int(),
  payload: z.any(),
  stepStatus: PostTurnStepStatusSchema,

  // Derived once at invocation time.
  session: z.any(),
  recentMemoriesStr: z.string(),

  // Populated as graph runs.
  signals: z.any().optional(),
  writePlan: z.any().optional(),
  consolidationEnqueued: z.boolean().optional(),
  completedSteps: z.array(PostTurnStepNameSchema),

  // Failure-mode metadata.
  lastRetryReason: PostTurnRetryReasonSchema.optional(),

  // Error accumulator.
  errors: z
    .array(z.object({ stage: z.string(), message: z.string() }))
    .optional(),
});

/** Inferred TypeScript type for the post-turn graph state. */
export type PostTurnGraphState = z.infer<typeof PostTurnGraphStateSchema>;

import * as z from "zod";
import type { StructMemConsolidationJob } from "../../db/schema/structmem";
import type { ConsolidationCandidateEntry } from "../../memory/structmem/structmemConsolidationSelection";
import type { StructMemConsolidationSynthesisResult } from "../../memory/structmem/structmemConsolidationSynthesis";

// ---------------------------------------------------------------------------
// Status / failure reason enums
// ---------------------------------------------------------------------------

export const STRUCTMEM_CONSOLIDATION_GRAPH_STATUS = [
  "completed",
  "skipped",
] as const;
export type StructMemConsolidationGraphStatus =
  (typeof STRUCTMEM_CONSOLIDATION_GRAPH_STATUS)[number];

export const STRUCTMEM_CONSOLIDATION_FAILURE_REASONS = [
  "job_not_found",
  "job_not_running",
  "insufficient_candidates",
  "synthesis_failed",
  "embedding_failed",
  "db_write_failed",
  "cross_session_write_failed",
] as const;
export type StructMemConsolidationFailureReason =
  (typeof STRUCTMEM_CONSOLIDATION_FAILURE_REASONS)[number];

// ---------------------------------------------------------------------------
// Input state — set before graph invocation
// ---------------------------------------------------------------------------

export interface StructMemConsolidationGraphStateInput {
  jobId: string;
}

// ---------------------------------------------------------------------------
// Full runtime state
// ---------------------------------------------------------------------------

export interface StructMemConsolidationGraphStateRuntime
  extends StructMemConsolidationGraphStateInput {
  job?: StructMemConsolidationJob;

  // Selection
  bufferEntries?: ConsolidationCandidateEntry[];
  semanticSeedEntries?: ConsolidationCandidateEntry[];
  bufferCount?: number;
  semanticSeedCount?: number;
  sourceEventCount?: number;
  selectedEntryCount?: number;
  turnStart?: number | null;
  turnEnd?: number | null;

  // Synthesis
  synthesis?: StructMemConsolidationSynthesisResult;
  synthesisTokenCount?: number | null;

  // Embedding
  embedding?: number[];

  // Persistence
  currentConsolidationId?: string;
  sourceEntryCount?: number;
  sourceLinkCount?: number;

  // Cross-session
  crossSessionStatus?: string;
  crossSessionIds?: string[];
  continuityFamily?: string;
  promotionStatus?: string;
  promotionCount?: number;

  // Final status
  finalStatus?: StructMemConsolidationGraphStatus;
  skippedReason?: string;
  failureReason?: StructMemConsolidationFailureReason;

  // Error accumulator
  errors?: Array<{ stage: string; message: string }>;
}

// ---------------------------------------------------------------------------
// Zod schema for LangGraph state
// ---------------------------------------------------------------------------

export const StructMemConsolidationGraphStateSchema = z.object({
  // Provided as input
  jobId: z.string(),

  // Populated by loadClaimedConsolidationJob
  job: z.any().optional(),

  // Populated by selectConsolidationBuffer
  bufferEntries: z.any().optional(),
  semanticSeedEntries: z.any().optional(),
  bufferCount: z.number().int().optional(),
  semanticSeedCount: z.number().int().optional(),
  sourceEventCount: z.number().int().optional(),
  selectedEntryCount: z.number().int().optional(),
  turnStart: z.number().int().nullable().optional(),
  turnEnd: z.number().int().nullable().optional(),

  // Populated by synthesizeCurrentSessionConsolidation
  synthesis: z.any().optional(),
  synthesisTokenCount: z.number().int().nullable().optional(),

  // Populated by embedConsolidation
  embedding: z.array(z.number()).optional(),

  // Populated by persistCurrentSessionConsolidation
  currentConsolidationId: z.string().optional(),
  sourceEntryCount: z.number().int().optional(),
  sourceLinkCount: z.number().int().optional(),

  // Populated by maybeWriteCrossSessionConsolidations
  crossSessionStatus: z.string().optional(),
  crossSessionIds: z.array(z.string()).optional(),
  continuityFamily: z.string().optional(),
  promotionStatus: z.string().optional(),
  promotionCount: z.number().int().optional(),

  // Final status
  finalStatus: z.enum(STRUCTMEM_CONSOLIDATION_GRAPH_STATUS).optional(),
  skippedReason: z.string().optional(),
  failureReason: z
    .enum(STRUCTMEM_CONSOLIDATION_FAILURE_REASONS)
    .optional(),

  // Error accumulator
  errors: z
    .array(z.object({ stage: z.string(), message: z.string() }))
    .optional(),
});

/** Inferred TypeScript type for the graph state. */
export type StructMemConsolidationGraphState = z.infer<
  typeof StructMemConsolidationGraphStateSchema
>;

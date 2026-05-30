/**
 * Shared types for the internal-logic evidence miner.
 *
 * These types define the canon-chunk reading, LLM proposal, and validated
 * proposal pipeline. All pure types — no DB/LLM imports.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Internal-logic node constants (mirrors evidenceSeeds.ts)
// ---------------------------------------------------------------------------

export const INTERNAL_LOGIC_NODES = [
  "growth_environment",
  "core_belief",
  "core_motivation",
  "core_fear",
  "defense_mechanism",
  "transition_rule",
  "relationship_scope_gate",
  "expression_constraint",
] as const;

export type InternalLogicNode = (typeof INTERNAL_LOGIC_NODES)[number];

// ---------------------------------------------------------------------------
// Canon chunk — a single story_unit with full provenance
// ---------------------------------------------------------------------------

export interface ContextUnit {
  text: string;
  speaker: string | null;
  unitIndex: number;
}

export interface CanonChunk {
  text: string;
  speaker: string | null;
  arcKey: string;
  chapterKey: string;
  episodeLabel: string;
  sceneOrder: number;
  unitIndex: number;
  storySceneId: string;
  /** Scene-local units immediately before this chunk (same scene, no cross-scene bleed). */
  contextBefore: ContextUnit[];
  /** Scene-local units immediately after this chunk (same scene, no cross-scene bleed). */
  contextAfter: ContextUnit[];
}

// ---------------------------------------------------------------------------
// LLM proposal types
// ---------------------------------------------------------------------------

/** Raw proposal returned by the LLM (node not yet validated). */
export interface LlmProposal {
  chunkRef: number;
  node: string;
  claimText: string;
  evidenceText: string;
  confidenceScore: number;
}

/** Zod schema for LlmProposalOutput — used in chatJsonWithFallback. */
export const LlmProposalSchema = z.object({
  chunkRef: z.number(),
  node: z.string(),
  claimText: z.string(),
  evidenceText: z.string(),
  confidenceScore: z.number().min(0).max(1),
});

export const LlmProposalOutputSchema = z.object({
  proposals: z.array(LlmProposalSchema),
});

export type LlmProposalOutput = z.infer<typeof LlmProposalOutputSchema>;

// ---------------------------------------------------------------------------
// Validated proposal — node validated, chunkRef resolved to provenance
// ---------------------------------------------------------------------------

export interface MappedProposal {
  chunk: CanonChunk;
  node: InternalLogicNode;
  claimText: string;
  evidenceText: string;
  confidenceScore: number;
}

// ---------------------------------------------------------------------------
// TG2: Existing row (for dedup lookups)
// ---------------------------------------------------------------------------

/** Shape of an existing internal_logic_evidence row for dedup. */
export interface ExistingEvidenceRow {
  id: string;
  node: string;
  evidenceText: string;
  embedding: number[] | null;
}

// ---------------------------------------------------------------------------
// TG2: Row data for insertion (mirrors seed pattern)
// ---------------------------------------------------------------------------

export interface EvidenceRowData {
  characterId: string;
  node: InternalLogicNode;
  claimText: string;
  evidenceText: string;
  embedding: number[] | null;
  arcKey: string | null;
  chapterKey: string | null;
  episodeLabel: string | null;
  sceneOrder: number | null;
  unitIndex: number | null;
  storySceneId: string | null;
  scopeApplicability: Record<string, unknown>;
  sourceKind: "canon";
  status: "proposed";
  confidenceScore: number | null;
  metadata: {
    source: "evidence_miner";
    model?: string;
    promptVersion?: string;
    minedAt: string;
    sourceUnitIndex: number;
    sourceSceneOrder: number;
    minedBatchId: string;
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

export const DEFAULT_CHARACTER = "zuo_ran";
export const DEFAULT_MIN_CONFIDENCE = 0.6;
export const BATCH_SIZE = 15;
export const DEFAULT_MAX_CHUNKS = 200;
export const DEDUP_SIM = 0.93;

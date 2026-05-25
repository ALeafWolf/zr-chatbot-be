export interface Assertion {
  type: string;
  value?: string;
  values?: string[];
  field?: string;
  expected?: boolean;
  description: string;
  /** For attribution_* assertions: regex strings tested against reply. */
  reply_attribution_patterns?: string[];
  /** Substrings that must appear in retrieved canon when attribution patterns match. */
  canon_support_needles?: string[];
  /** For no_unsupported_attribution: if reply has these substrings, canon must contain support_needles. */
  reply_entity_markers?: string[];
  /** For retrieval_min_anchors — minimum scene anchor count (retrieval eval). */
  min_scenes?: number;
}

export interface Scenario {
  id: string;
  description: string;
  group?: string;
  /** `retrieval` runs canon retrieval only; `agent_turn` runs an isolated full backend turn. */
  eval_mode?: "default" | "retrieval" | "agent_turn";
  session: {
    mode: string;
    continuity_scope: string;
    continuity_family: string;
    writeback_policy?: string;
  };
  messages?: Array<{ role: string; content: string }>;
  primed_memories?: unknown[];
  sessionSeed?: unknown;
  recentMessages?: unknown[];
  sessionSummary?: string;
  sessionState?: unknown;
  durableMemories?: unknown[];
  sessionChunks?: unknown[];
  structMemEntries?: unknown[];
  structMemConsolidations?: unknown[];
  canonReferenceIds?: string[];
  configOverrides?: Record<string, unknown>;
  input_draft?: string;
  /** Fixture canon excerpt for validator-only Tier 4 attribution evals. */
  validator_retrieved_canon?: string;
  assertions: Assertion[];
  /** Expected substring in retrieved canon for retrieval-quality metrics. */
  retrieval_expected_needle?: string;

  // --- Rerank scenario fields (optional, for LangSmith metadata) ---
  /** Memory IDs the reranker should select. */
  expected_selected_ids?: string[];
  /** Memory IDs the reranker should reject. */
  expected_rejected_ids?: string[];
  /** Expected final context mode after reranking (e.g. "selected_memory", "recent_only", "memory_and_canon"). */
  expected_final_context_mode?: string;
}

export interface ScenariosFile {
  version: string;
  description?: string;
  scenarios: Scenario[];
}

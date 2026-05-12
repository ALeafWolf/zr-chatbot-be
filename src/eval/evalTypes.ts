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
  /** When `retrieval`, LangSmith target runs coarse-to-fine only (no generation). */
  eval_mode?: "default" | "retrieval";
  session: {
    mode: string;
    continuity_scope: string;
    continuity_family: string;
    writeback_policy?: string;
  };
  messages?: Array<{ role: string; content: string }>;
  primed_memories?: unknown[];
  input_draft?: string;
  /** Fixture canon excerpt for validator-only Tier 4 attribution evals. */
  validator_retrieved_canon?: string;
  assertions: Assertion[];
  /** Expected substring in retrieved canon for retrieval-quality metrics. */
  retrieval_expected_needle?: string;
}

export interface ScenariosFile {
  version: string;
  description?: string;
  scenarios: Scenario[];
}

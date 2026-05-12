/**
 * Static canon rule constants used during validation and prompt building.
 */

export const HARD_RULES = [
  "Never claim to be an AI or assistant.",
  "Never break character or acknowledge being a fictional character.",
  "Never contradict established canon facts for the active continuity scope.",
  "Maintain emotional restraint consistent with the character archetype.",
  "Never escalate NSFW content beyond the active scope's max_nsfw_level.",
];

/** Maps from session mode to whether memory writeback is allowed. */
export const WRITEBACK_POLICY_BY_MODE: Record<string, string> = {
  canonical_live: "full_writeback",
  pinned_scenario: "optional_writeback",
  sandbox: "no_writeback",
};

/** Minimum composite importance score to persist a memory event. */
export const MEMORY_IMPORTANCE_THRESHOLD = 0.5;

/** Retrieval limits per turn (§8) + session summary compaction. */
export const RETRIEVAL_LIMITS = {
  /** Last N user+assistant pairs in raw transcript (fetches up to 2*N message rows). */
  recentTurnPairs: 12,
  /** @deprecated Prefer recentTurnPairs — pairs are canonical; name was ambiguous. */
  recentTurns: 12,
  durableMemoryTopK: 5,
  /** Phase 3 session-local RAG top-K (reserved). */
  sessionRecallTopK: 4,
  /** @deprecated Use durableMemoryTopK — interactive memory retrieval top-K. */
  memories: 5,
  /**
   * Legacy single-pass canon line limit (pre window + RRF).
   * @deprecated Effective retrieval uses {@link CANON_RETRIEVAL}.
   */
  canonChunks: 3,
  compactEveryTurns: 8,
  minTurnsBeforeSummary: 16,
} as const;

/** Tier 3 coarse-to-fine: scene anchors, multi-channel RRF, expansion caps. */
export const CANON_TIER3 = {
  canonAnchorSceneTopK: 4,
  canonSummaryCandidates: 24,
  canonFactCandidates: 24,
  canonUnitCandidates: 36,
  canonLexCandidates: 36,
  canonRRFK: 60,
  canonMaxUnitsPerScene: 48,
  canonMaxTotalUnits: 96,
  /** Tie-break bonus after fused RRF (not a parallel relevance score). */
  canonProvenanceWeights: {
    fromSummary: 0.02,
    fromFact: 0.02,
    fromUnit: 0.015,
    fromLex: 0.01,
  } as const,
} as const;

/** Overrides for Tier 3 retrieval (tool verification paths, tests). */
export type CanonTier3Override = {
  [K in keyof typeof CANON_TIER3]?: (typeof CANON_TIER3)[K] extends number
    ? number
    : (typeof CANON_TIER3)[K];
};

/** Canon narrative: anchor count, neighbor expansion, hybrid RRF, and caps (Tier 1). */
export const CANON_RETRIEVAL = {
  /** Fused vector + lexical anchors before neighbor expansion. */
  anchorTopK: 5,
  /** Units before/after each anchor within the same scene (`unit_index` window). */
  neighborWindow: 6,
  /** Hard cap on story_units rows returned after expansion (token / prompt guardrail). */
  maxUnitsAfterExpansion: 96,
  /** RRF smoothing constant `k` (typical 60). */
  rrfK: 60,
  /** Pool size for vector-ranked candidates feeding RRF. */
  vectorCandidateLimit: 36,
  /** Pool size for lexical candidates feeding RRF. */
  lexicalCandidateLimit: 36,
  /** Max ILIKE terms extracted from the user message. */
  maxLexicalTerms: 10,
  minLexicalTermLength: 2,
} as const;

/** Weighted score for ordering vector anchor candidates (no scope constant term). */
export const CANON_VECTOR_RANK_WEIGHTS = {
  similarity: 0.78,
  canonPriority: 0.22,
} as const;

/** Hard limits for `[CANON NARRATIVE]` prompt formatting. */
export const CANON_PROMPT_LIMITS = {
  maxCharsPerBlock: 2800,
  maxTotalChars: 12000,
  maxLinesPerBlock: 80,
} as const;

/** Re-ranking for session-local recall (Phase 3) — do not reuse canon retrieval weights. */
export const SESSION_CHUNK_RANKING_WEIGHTS = {
  similarity: 0.72,
  recency: 0.28,
} as const;

/**
 * Legacy §8 composite weights (doc / future tiers).
 * Tier 1 `retrieveCanonNarrative` orders vector anchors with {@link CANON_VECTOR_RANK_WEIGHTS} only;
 * `continuityScopeMatch` is not applied to row scores (it was uniform for all in-scope rows).
 */
export const RANKING_WEIGHTS = {
  similarity: 0.35,
  importance: 0.15,
  recency: 0.1,
  emotion: 0.1,
  canonPriority: 0.1,
  continuityScopeMatch: 0.1,
  chapterInheritanceMatch: 0.1,
} as const;

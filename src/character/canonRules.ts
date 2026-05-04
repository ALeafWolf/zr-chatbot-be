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

/** Retrieval limits per turn (§8). */
export const RETRIEVAL_LIMITS = {
  memories: 5,
  canonChunks: 3,
  recentTurns: 12,
} as const;

/** Ranking weights for canon retrieval (§8 formula). */
export const RANKING_WEIGHTS = {
  similarity: 0.35,
  importance: 0.15,
  recency: 0.1,
  emotion: 0.1,
  canonPriority: 0.1,
  continuityScopeMatch: 0.1,
  chapterInheritanceMatch: 0.1,
} as const;

/**
 * TG0 — Replay harness types for the OOC intimate-scene replay.
 *
 * These types define the per-turn and aggregate metric outputs, history
 * variant modes, and the replay scenario format derived from the evidence
 * transcript.
 */

// ---------------------------------------------------------------------------
// History variants (design finding H)
// ---------------------------------------------------------------------------

export type HistoryVariant = "raw" | "sanitized";

export const HISTORY_VARIANTS: HistoryVariant[] = ["raw", "sanitized"];

// ---------------------------------------------------------------------------
// Per-turn OOC metrics
// ---------------------------------------------------------------------------

export interface OocPerTurnMetrics {
  /** Full final assistant reply, retained for offline metric adjudication. */
  replyText: string;
  /** 0-based turn index in the transcript (260–291). */
  turnIndex: number;
  /** Number of characters in the assistant reply. */
  replyLength: number;
  /** Number of sentences in the assistant reply (split by Chinese/English punctuation). */
  sentenceCount: number;
  /** Ratio of short sentences (<5 chars) to total sentences. */
  shortSentenceRatio: number;
  /** Number of clinical/academic word hits (word list from design). */
  clinicalWordHits: number;
  /** Clinical-word density: hits / total chars * 1000. */
  clinicalWordDensity: number;
  /** Number of parenthetical monologue spans ≥30 Chinese chars. */
  longParentheticalMonologueCount: number;
  /** Total number of parenthetical spans in the reply. */
  parentheticalSpanCount: number;
  /** Number of literal 「心想」 or 「内心」 hits. */
  literalXiangXinNeiXinHits: number;
  /** Number of strict narrator-tag parenthetical spans. */
  xiangXinNeiXinSpanTagCount: number;
}

// ---------------------------------------------------------------------------
// Aggregate (multi-turn) OOC metrics
// ---------------------------------------------------------------------------

export interface OocAggregateMetrics {
  /** Number of turns measured. */
  turnCount: number;
  /** History variant used. */
  variant: HistoryVariant;
  /** Mean reply length across all turns. */
  meanReplyLength: number;
  /** Median reply length. */
  medianReplyLength: number;
  /** Min reply length. */
  minReplyLength: number;
  /** Max reply length. */
  maxReplyLength: number;
  /** Mean short-sentence ratio. */
  meanShortSentenceRatio: number;
  /** Mean clinical-word density (hits / 1000 chars). */
  meanClinicalWordDensity: number;
  /** Total clinical-word hits across all turns. */
  totalClinicalWordHits: number;
  /** Total long parenthetical monologue spans across all turns. */
  totalLongParentheticalMonologue: number;
  /** Turns with at least one long parenthetical monologue. */
  turnsWithLongMonologue: number;
  /** Turns with at least one clinical word hit. */
  turnsWithClinicalWords: number;
  /** Total literal 「心想」/「内心」 hits. */
  totalLiteralXiangXinNeiXinHits: number;
  totalXiangXinNeiXinSpanTags: number;
  /** Per-turn metrics array. */
  perTurn: OocPerTurnMetrics[];
}

// ---------------------------------------------------------------------------
// Replay turn — a single turn from the transcript
// ---------------------------------------------------------------------------

export interface ReplayTurn {
  turnIndex: number;
  userMessage: string;
  originalAssistantReply?: string;
}

// ---------------------------------------------------------------------------
// Full replay scenario loaded from the transcript
// ---------------------------------------------------------------------------

export interface ReplayScenario {
  sessionId: string;
  title: string;
  /** Seed messages: turns 1–259 (0-indexed turnIndex 0–258). */
  seedMessages: Array<{ role: "user" | "assistant"; content: string; turnIndex: number }>;
  /** Replay turns: turns 260–291 (0-indexed turnIndex 259–290). */
  replayTurns: ReplayTurn[];
  /**
   * Emotional axis state at the seed boundary (turn 259's
   * post-turn axis state) for seedAxisState seeding.
   */
  seedAxisState?: Record<string, unknown>;
  sessionSummary?: string;
  durableMemories?: Array<Record<string, unknown>>;
  structMemEntries?: Array<Record<string, unknown>>;
  sessionChunks?: Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// CLI options
// ---------------------------------------------------------------------------

export interface ReplayCliOptions {
  variant: HistoryVariant;
  scenarioPath?: string;
  skipModelCalls?: boolean;
  maxTurns?: number;
}

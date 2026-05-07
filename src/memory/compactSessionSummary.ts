import { RETRIEVAL_LIMITS } from "../character/canonRules";
import type { ChatSession } from "../db/schema/chat";
import { getMessagesByTurnRange } from "../retrieval/getMessagesByTurnRange";
import { getSessionSummary, upsertSessionSummary } from "./sessionSummaryRepo";
import { runSessionSummaryMerger } from "../llm/runSessionSummaryMerger";
import { traceStage } from "../observability/langsmithTracing";

export interface MaybeCompactSessionSummaryInput {
  session: ChatSession;
  /** Highest completed message turn_index in this session (typically assistant row). */
  latestTurnIndex: number;
}

/** LangSmith-friendly cap; full text stays in Postgres. */
const MAX_SUMMARY_TEXT_IN_TRACE_CHARS = 24_000;

function clipSummaryTextForTrace(summaryText: string): {
  summaryTextInTrace: string;
  summaryTextTruncated: boolean;
} {
  if (summaryText.length <= MAX_SUMMARY_TEXT_IN_TRACE_CHARS) {
    return { summaryTextInTrace: summaryText, summaryTextTruncated: false };
  }
  return {
    summaryTextInTrace:
      `${summaryText.slice(0, MAX_SUMMARY_TEXT_IN_TRACE_CHARS)}\n…[truncated: ${summaryText.length} chars total — see Postgres session_summaries.summary_text]`,
    summaryTextTruncated: true,
  };
}

/** Returned from `maybeCompactSessionSummary` for LangSmith `outputs`. */
export type SessionSummaryCompactResult =
  | {
      status: "skipped";
      reason: string;
      sessionId: string;
      latestTurnIndex: number;
      recentWindowStart?: number;
      summarizedThrough?: number;
      gap?: number;
      minTurnsBeforeSummary?: number;
      compactEveryTurns?: number;
      /** Set when skipped due to invalid range after gap check. */
      fromTurnIndex?: number;
      toTurnIndex?: number;
    }
  | {
      status: "compacted";
      sessionId: string;
      latestTurnIndex: number;
      fromTurnIndex: number;
      toTurnIndex: number;
      lastSummarizedTurnIndex: number;
      mergedMessageCount: number;
      summaryTextChars: number;
      /** Substring of persisted `summary_text` (truncated if very long — full text is in DB). */
      summaryText: string;
      summaryTextTruncated: boolean;
      summaryJsonTopLevelKeys: string[];
    };

async function compactSessionSummaryImpl(
  input: MaybeCompactSessionSummaryInput,
): Promise<SessionSummaryCompactResult> {
  const { session, latestTurnIndex } = input;
  const { sessionId } = session;
  const minTurns = RETRIEVAL_LIMITS.minTurnsBeforeSummary;
  const compactEvery = RETRIEVAL_LIMITS.compactEveryTurns;

  if (latestTurnIndex < minTurns) {
    return {
      status: "skipped",
      reason: "below_min_turns_before_summary",
      sessionId,
      latestTurnIndex,
      minTurnsBeforeSummary: minTurns,
    };
  }

  const pairRows = RETRIEVAL_LIMITS.recentTurnPairs * 2;
  const recentWindowStart = Math.max(
    0,
    latestTurnIndex - pairRows + 1,
  );

  const existing = await getSessionSummary(sessionId);
  const summarizedThrough = existing?.lastSummarizedTurnIndex ?? -1;

  const gap = recentWindowStart - (summarizedThrough + 1);
  if (gap < compactEvery) {
    return {
      status: "skipped",
      reason: "gap_below_compact_every_turns",
      sessionId,
      latestTurnIndex,
      recentWindowStart,
      summarizedThrough,
      gap,
      compactEveryTurns: compactEvery,
    };
  }

  const fromTurnIndex = summarizedThrough + 1;
  const toTurnIndex = recentWindowStart - 1;

  if (fromTurnIndex > toTurnIndex) {
    return {
      status: "skipped",
      reason: "empty_turn_range",
      sessionId,
      latestTurnIndex,
      recentWindowStart,
      summarizedThrough,
      gap,
      fromTurnIndex,
      toTurnIndex,
    };
  }

  const messages = await getMessagesByTurnRange({
    sessionId,
    fromTurnIndex,
    toTurnIndex,
  });

  const merged = await runSessionSummaryMerger({
    existingSummaryJson: existing?.summaryJson ?? null,
    messages,
    fromTurnIndex,
    toTurnIndex,
  });

  await upsertSessionSummary({
    sessionId,
    characterId: session.characterId,
    playerId: session.playerId,
    lastSummarizedTurnIndex: toTurnIndex,
    summaryJson: merged.summaryJson,
    summaryText: merged.summaryText,
    existingId: existing?.id,
  });

  const summaryText = merged.summaryText;
  const { summaryTextInTrace, summaryTextTruncated } =
    clipSummaryTextForTrace(summaryText);

  const summaryJsonTopLevelKeys =
    merged.summaryJson && typeof merged.summaryJson === "object" && !Array.isArray(merged.summaryJson)
      ? Object.keys(merged.summaryJson as Record<string, unknown>)
      : [];

  return {
    status: "compacted",
    sessionId,
    latestTurnIndex,
    fromTurnIndex,
    toTurnIndex,
    lastSummarizedTurnIndex: toTurnIndex,
    mergedMessageCount: messages.length,
    summaryTextChars: summaryText.length,
    summaryText: summaryTextInTrace,
    summaryTextTruncated,
    summaryJsonTopLevelKeys,
  };
}

export const maybeCompactSessionSummary = traceStage(
  "memory.session_summary_compact",
  compactSessionSummaryImpl,
);

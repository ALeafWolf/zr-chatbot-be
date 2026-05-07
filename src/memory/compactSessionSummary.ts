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

async function compactSessionSummaryImpl(
  input: MaybeCompactSessionSummaryInput,
): Promise<void> {
  const { session, latestTurnIndex } = input;
  const { sessionId } = session;

  if (latestTurnIndex < RETRIEVAL_LIMITS.minTurnsBeforeSummary) {
    return;
  }

  const pairRows = RETRIEVAL_LIMITS.recentTurnPairs * 2;
  const recentWindowStart = Math.max(
    0,
    latestTurnIndex - pairRows + 1,
  );

  const existing = await getSessionSummary(sessionId);
  const summarizedThrough = existing?.lastSummarizedTurnIndex ?? -1;

  const gap = recentWindowStart - (summarizedThrough + 1);
  if (gap < RETRIEVAL_LIMITS.compactEveryTurns) {
    return;
  }

  const fromTurnIndex = summarizedThrough + 1;
  const toTurnIndex = recentWindowStart - 1;

  if (fromTurnIndex > toTurnIndex) {
    return;
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
}

export const maybeCompactSessionSummary = traceStage(
  "memory.session_summary_compact",
  compactSessionSummaryImpl,
);

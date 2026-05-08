import { RETRIEVAL_LIMITS } from "../character/canonRules";

/**
 * First message `turn_index` still inside the raw recent window when the frontier
 * is the assistant's turn index (`session_state.last_turn_index`).
 *
 * Mirrors [`compactSessionSummary`](./compactSessionSummary.ts) compaction boundary.
 */
export function recentConversationWindowStartTurn(
  latestAssistantTurnIndex: number,
): number {
  const rowSpan = RETRIEVAL_LIMITS.recentTurnPairs * 2;
  return Math.max(0, latestAssistantTurnIndex - rowSpan + 1);
}

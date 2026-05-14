import { RETRIEVAL_LIMITS } from "../../character/canonRules";

export function recentConversationWindowStartTurn(
  latestAssistantTurnIndex: number,
): number {
  const rowSpan = RETRIEVAL_LIMITS.recentTurnPairs * 2;
  return Math.max(0, latestAssistantTurnIndex - rowSpan + 1);
}

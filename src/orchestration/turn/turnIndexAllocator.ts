export interface TurnIndexAllocationInput {
  maxMessageTurnIndex: number | null;
  sessionStateLastTurnIndex: number | null;
}

export interface TurnIndexAllocation {
  userTurnIndex: number;
  assistantTurnIndex: number;
}

export function calculateNextTurnIndexes(
  input: TurnIndexAllocationInput,
): TurnIndexAllocation {
  const maxMessage =
    input.maxMessageTurnIndex === null ||
    input.maxMessageTurnIndex === undefined
      ? -1
      : input.maxMessageTurnIndex;

  if (maxMessage < 0) {
    return { userTurnIndex: 0, assistantTurnIndex: 1 };
  }

  const stateLast =
    input.sessionStateLastTurnIndex === null ||
    input.sessionStateLastTurnIndex === undefined
      ? -1
      : input.sessionStateLastTurnIndex;
  const frontier = Math.max(maxMessage, stateLast);
  return {
    userTurnIndex: frontier + 1,
    assistantTurnIndex: frontier + 2,
  };
}

import type { SessionState } from "../../db/schema/chat";

export interface LatestTurnDelta {
  kind: "latest_turn_delta";
  sourceTurnStart: number;
  sourceTurnEnd: number;
  expiresAfterTurn: number;
  facts: string[];
  pendingActions: string[];
  relationshipSignals: string[];
}

const TURN_DELTA_TTL_TURNS = 4;

function firstUsefulSentence(text: string): string | null {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  const sentence = trimmed.split(/[。！？.!?]\s*/u).find(Boolean) ?? trimmed;
  return sentence.slice(0, 220);
}

function collectWhenMatched(text: string, patterns: RegExp[]): string[] {
  if (!patterns.some((pattern) => pattern.test(text))) return [];
  const sentence = firstUsefulSentence(text);
  return sentence ? [sentence] : [];
}

export function deriveTurnDelta(input: {
  userMessage: string;
  assistantReply: string;
  userTurnIndex: number;
  assistantTurnIndex: number;
}): LatestTurnDelta {
  const joined = `${input.userMessage}\n${input.assistantReply}`;
  const facts = [
    firstUsefulSentence(input.userMessage),
    firstUsefulSentence(input.assistantReply),
  ].filter((x): x is string => Boolean(x));

  return {
    kind: "latest_turn_delta",
    sourceTurnStart: input.userTurnIndex,
    sourceTurnEnd: input.assistantTurnIndex,
    expiresAfterTurn: input.assistantTurnIndex + TURN_DELTA_TTL_TURNS,
    facts: facts.slice(0, 2),
    pendingActions: collectWhenMatched(joined, [
      /promise|plan|later|next time|remind|pending/i,
      /承诺|约定|计划|之后|待会|下次|记得|提醒/u,
    ]),
    relationshipSignals: collectWhenMatched(joined, [
      /trust|closer|distance|relationship|love|hurt/i,
      /信任|靠近|疏远|关系|喜欢|爱|委屈|难过/u,
    ]),
  };
}

export function readFreshTurnDelta(
  sessionStateRow: SessionState | null,
  latestFrontierTurnIndex: number,
): LatestTurnDelta | null {
  const value = sessionStateRow?.temporaryAssumptions;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const maybe = value as Partial<LatestTurnDelta>;
  if (maybe.kind !== "latest_turn_delta") return null;
  if (
    typeof maybe.sourceTurnStart !== "number" ||
    typeof maybe.sourceTurnEnd !== "number" ||
    typeof maybe.expiresAfterTurn !== "number" ||
    !Array.isArray(maybe.facts) ||
    !Array.isArray(maybe.pendingActions) ||
    !Array.isArray(maybe.relationshipSignals)
  ) {
    return null;
  }
  if (latestFrontierTurnIndex > maybe.expiresAfterTurn) return null;

  return {
    kind: "latest_turn_delta",
    sourceTurnStart: maybe.sourceTurnStart,
    sourceTurnEnd: maybe.sourceTurnEnd,
    expiresAfterTurn: maybe.expiresAfterTurn,
    facts: maybe.facts.map(String).filter(Boolean).slice(0, 3),
    pendingActions: maybe.pendingActions.map(String).filter(Boolean).slice(0, 3),
    relationshipSignals: maybe.relationshipSignals
      .map(String)
      .filter(Boolean)
      .slice(0, 3),
  };
}

export function formatTurnDelta(delta: LatestTurnDelta): string {
  const parts = [
    `Source turns: ${delta.sourceTurnStart}-${delta.sourceTurnEnd}. Use only for immediate continuity; RECENT CHAT overrides it.`,
    delta.facts.length ? `Latest facts:\n- ${delta.facts.join("\n- ")}` : "",
    delta.pendingActions.length
      ? `Pending actions:\n- ${delta.pendingActions.join("\n- ")}`
      : "",
    delta.relationshipSignals.length
      ? `Relationship signals:\n- ${delta.relationshipSignals.join("\n- ")}`
      : "",
  ].filter(Boolean);
  return parts.join("\n\n");
}

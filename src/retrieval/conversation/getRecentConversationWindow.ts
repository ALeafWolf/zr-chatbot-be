import { db } from "../../db/client";
import { chatMessages } from "../../db/schema/chat";
import { and, desc, eq } from "drizzle-orm";
import { RETRIEVAL_LIMITS } from "../../character/canonRules";
import {
  ROLEPLAY_TURN_ROUTE,
  type TurnRoute,
} from "../../orchestration/turnRoutes";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  turnIndex: number;
}

/**
 * Return the last `pairCount` user+assistant pairs as individual message rows, chronologically.
 * A pair is two rows (user + assistant); we fetch up to pairCount * 2 messages.
 */
export async function getRecentConversationWindow(
  sessionId: string,
  pairCount: number = RETRIEVAL_LIMITS.recentTurnPairs,
  route: TurnRoute = ROLEPLAY_TURN_ROUTE,
): Promise<ConversationTurn[]> {
  const rowLimit = pairCount * 2;

  const rows = await db
    .select({
      role: chatMessages.role,
      content: chatMessages.content,
      turnIndex: chatMessages.turnIndex,
    })
    .from(chatMessages)
    .where(and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.route, route)))
    .orderBy(desc(chatMessages.turnIndex))
    .limit(rowLimit);

  return rows
    .reverse()
    .map((r) => ({
      role: r.role as "user" | "assistant",
      content: r.content,
      turnIndex: r.turnIndex,
    }));
}

export async function getLatestConversationRouteTurnIndex(
  sessionId: string,
  route: TurnRoute = ROLEPLAY_TURN_ROUTE,
): Promise<number | null> {
  const rows = await db
    .select({ turnIndex: chatMessages.turnIndex })
    .from(chatMessages)
    .where(and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.route, route)))
    .orderBy(desc(chatMessages.turnIndex))
    .limit(1);

  return rows[0]?.turnIndex ?? null;
}

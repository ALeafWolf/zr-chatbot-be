import { db } from "../db/client";
import { chatMessages } from "../db/schema/chat";
import { eq, desc, asc } from "drizzle-orm";
import { RETRIEVAL_LIMITS } from "../character/canonRules";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  turnIndex: number;
}

/**
 * Return the last N turns of a session ordered chronologically.
 * Used for the [RECENT CHAT] prompt block and for post-turn extractor context.
 */
export async function getRecentConversationWindow(
  sessionId: string,
  limit: number = RETRIEVAL_LIMITS.recentTurns,
): Promise<ConversationTurn[]> {
  // Fetch the last N messages descending, then re-sort ascending for prompt order
  const rows = await db
    .select({
      role: chatMessages.role,
      content: chatMessages.content,
      turnIndex: chatMessages.turnIndex,
    })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(desc(chatMessages.turnIndex))
    .limit(limit);

  return rows
    .reverse()
    .map((r) => ({
      role: r.role as "user" | "assistant",
      content: r.content,
      turnIndex: r.turnIndex,
    }));
}

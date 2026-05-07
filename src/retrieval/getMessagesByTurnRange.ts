import { db } from "../db/client";
import { chatMessages } from "../db/schema/chat";
import { and, asc, between, eq } from "drizzle-orm";

export interface MessageRow {
  role: "user" | "assistant";
  content: string;
  turnIndex: number;
}

/**
 * Inclusive range [fromTurnIndex, toTurnIndex], ascending order.
 */
export async function getMessagesByTurnRange(input: {
  sessionId: string;
  fromTurnIndex: number;
  toTurnIndex: number;
}): Promise<MessageRow[]> {
  const { sessionId, fromTurnIndex, toTurnIndex } = input;
  if (fromTurnIndex > toTurnIndex) return [];

  const rows = await db
    .select({
      role: chatMessages.role,
      content: chatMessages.content,
      turnIndex: chatMessages.turnIndex,
    })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.sessionId, sessionId),
        between(chatMessages.turnIndex, fromTurnIndex, toTurnIndex),
      ),
    )
    .orderBy(asc(chatMessages.turnIndex));

  return rows.map((r) => ({
    role: r.role as "user" | "assistant",
    content: r.content,
    turnIndex: r.turnIndex,
  }));
}

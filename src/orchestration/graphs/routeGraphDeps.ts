import { db } from "../../db/client";
import { chatSessions } from "../../db/schema/chat";
import { eq } from "drizzle-orm";
import type { ChatSession } from "../../db/schema/chat";

/**
 * Load a ChatSession by id, matching the same missing/deleted semantics as
 * the current turn pipeline.
 */
export async function loadSessionImpl(
  sessionId: string,
): Promise<ChatSession> {
  const rows = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.sessionId, sessionId))
    .limit(1);

  if (!rows[0]) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const session: ChatSession = rows[0];
  if (session.deletedAt) {
    throw new Error(`Session ${sessionId} has been deleted`);
  }

  return session;
}

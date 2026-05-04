import { db } from "../db/client";
import { sessionArchive } from "../db/schema/memory";
import { chatMessages } from "../db/schema/chat";
import { eq, asc } from "drizzle-orm";

/**
 * Refresh the session_archive for a given session.
 * In Phase 1 this produces a simple concatenation-based summary.
 * A proper LLM-generated summary can be swapped in as a Phase 2 enhancement.
 */
export async function summarizeSession(sessionId: string): Promise<void> {
  const messages = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.turnIndex))
    .limit(50);

  if (messages.length === 0) return;

  const lines = messages.map(
    (m) => `${m.role === "user" ? "用户" : "左然"}: ${m.content}`,
  );
  const summaryShort = lines.slice(-4).join("\n");
  const summaryMedium = lines.slice(-16).join("\n");

  await db
    .insert(sessionArchive)
    .values({
      sessionId,
      summaryShort,
      summaryMedium,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: sessionArchive.sessionId,
      set: { summaryShort, summaryMedium, updatedAt: new Date() },
    });
}

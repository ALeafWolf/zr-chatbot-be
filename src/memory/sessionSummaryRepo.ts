import { db } from "../db/client";
import { sessionSummaries } from "../db/schema/memory";
import type { SessionSummary } from "../db/schema/memory";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

export type SessionSummaryRecord = SessionSummary | null;

export async function getSessionSummary(
  sessionId: string,
): Promise<SessionSummaryRecord> {
  const rows = await db
    .select()
    .from(sessionSummaries)
    .where(eq(sessionSummaries.sessionId, sessionId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertSessionSummary(input: {
  sessionId: string;
  characterId: string;
  playerId: string;
  lastSummarizedTurnIndex: number;
  summaryJson: unknown;
  summaryText: string;
  existingId?: string;
}): Promise<void> {
  const now = new Date();
  const id = input.existingId ?? uuidv4();

  await db
    .insert(sessionSummaries)
    .values({
      id,
      sessionId: input.sessionId,
      characterId: input.characterId,
      playerId: input.playerId,
      lastSummarizedTurnIndex: input.lastSummarizedTurnIndex,
      summaryJson: input.summaryJson,
      summaryText: input.summaryText,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: sessionSummaries.sessionId,
      set: {
        characterId: input.characterId,
        playerId: input.playerId,
        lastSummarizedTurnIndex: input.lastSummarizedTurnIndex,
        summaryJson: input.summaryJson,
        summaryText: input.summaryText,
        updatedAt: now,
      },
    });
}

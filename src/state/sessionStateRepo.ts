import { db } from "../db/client";
import { sessionState } from "../db/schema/chat";
import { eq } from "drizzle-orm";
import type { SessionState } from "../db/schema/chat";

export interface DerivedState {
  inferredMood: string;
  inferredActivity: string;
  conversationalStance: string;
}

export async function getSessionState(
  sessionId: string,
): Promise<SessionState | null> {
  const rows = await db
    .select()
    .from(sessionState)
    .where(eq(sessionState.sessionId, sessionId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertSessionState(
  sessionId: string,
  update: {
    derivedState?: DerivedState;
    currentSceneContext?: Record<string, unknown>;
    localRelationshipDelta?: Record<string, unknown>;
    temporaryAssumptions?: Record<string, unknown>;
    lastTurnIndex?: number;
  },
): Promise<void> {
  const now = new Date();
  await db
    .insert(sessionState)
    .values({
      sessionId,
      derivedState: update.derivedState ?? null,
      currentSceneContext: update.currentSceneContext ?? null,
      localRelationshipDelta: update.localRelationshipDelta ?? null,
      temporaryAssumptions: update.temporaryAssumptions ?? null,
      lastTurnIndex: update.lastTurnIndex ?? 0,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: sessionState.sessionId,
      set: {
        ...(update.derivedState !== undefined && {
          derivedState: update.derivedState,
        }),
        ...(update.currentSceneContext !== undefined && {
          currentSceneContext: update.currentSceneContext,
        }),
        ...(update.localRelationshipDelta !== undefined && {
          localRelationshipDelta: update.localRelationshipDelta,
        }),
        ...(update.temporaryAssumptions !== undefined && {
          temporaryAssumptions: update.temporaryAssumptions,
        }),
        ...(update.lastTurnIndex !== undefined && {
          lastTurnIndex: update.lastTurnIndex,
        }),
        updatedAt: now,
      },
    });
}

/**
 * Compute derived_state from recent turns and character defaults.
 * Phase 1: heuristic rule-based computation; Phase 2 can add LLM-derived inference.
 */
export function computeDerivedState(
  recentTurnCount: number,
  lastUserMessage: string,
  characterDefaults: { interaction_defaults: { default_emotional_baseline: string } },
): DerivedState {
  const baseline = characterDefaults.interaction_defaults.default_emotional_baseline;

  // Simple heuristic: infer conversational stance from recent message length and content
  const isQuestion = lastUserMessage.trim().endsWith("?") || lastUserMessage.includes("吗") || lastUserMessage.includes("吧");
  const isShort = lastUserMessage.length < 20;

  return {
    inferredMood: baseline,
    inferredActivity: recentTurnCount === 0 ? "starting_conversation" : "in_conversation",
    conversationalStance: isQuestion
      ? "attentive"
      : isShort
        ? "relaxed"
        : "engaged",
  };
}

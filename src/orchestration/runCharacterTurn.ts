import { v4 as uuidv4 } from "uuid";
import { db } from "../db/client";
import { chatMessages, chatSessions } from "../db/schema/chat";
import { eq } from "drizzle-orm";
import { loadCharacterDefaults, loadPersonaOverlay } from "../character/characterDefaults";
import { resolveContext } from "./resolveContext";
import { buildPromptContext } from "./buildPromptContext";
import { generateAndValidate } from "./generateAndValidate";
import { upsertSessionState } from "../state/sessionStateRepo";
import { postTurnRunner } from "../jobs/postTurnRunner";
import type { ChatSession } from "../db/schema/chat";
import { traceStage } from "../observability/langsmithTracing";

export interface TurnInput {
  sessionId: string;
  userMessage: string;
}

export interface TurnOutput {
  assistantMessageId: string;
  content: string;
  wasRewritten: boolean;
  wasDeflected: boolean;
  turnIndex: number;
}

/**
 * The §7 Phase 1 turn flow — top to bottom:
 *
 * 1. Load session + character_defaults + persona + overlay
 * 2. Resolve continuity_scope and memory_namespace
 * 3. Retrieve interactive memories, canon scenes, recent turns (parallel)
 * 4. Compute derived_state
 * 5. Build prompt context
 * 6. Generate draft reply
 * 7. Validate → rewrite-once → deflect ladder
 * 8. Persist transcript (synchronous)
 * 9. Update session_state (synchronous)
 * 10. Return response to user
 * 11. Async: extractPostTurnSignals → write memory → refresh archive
 */
async function _runCharacterTurn(input: TurnInput): Promise<TurnOutput> {
  const { sessionId, userMessage } = input;

  // Step 1: Load session + defaults + overlay
  const sessionRows = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.sessionId, sessionId))
    .limit(1);

  if (!sessionRows[0]) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const session: ChatSession = sessionRows[0];

  if (session.deletedAt) {
    throw new Error(`Session ${sessionId} has been deleted`);
  }

  const characterDefaults = loadCharacterDefaults(session.characterId);
  const overlayId = session.personaOverlayId ?? `${session.continuityScope}`;
  const personaOverlay = loadPersonaOverlay(overlayId);

  // Steps 2–4: Parallel retrieval + derived_state (inside resolveContext)
  const context = await resolveContext({ session, userMessage, characterDefaults });

  // Step 5: Build prompt context
  const promptContext = buildPromptContext({
    characterDefaults,
    personaOverlay,
    session,
    derivedState: context.derivedState,
    memories: context.memories,
    canonChunks: context.canonChunks,
    recentTurns: context.recentTurns,
  });

  // Steps 6–7: Generate + validate with rewrite ladder
  const result = await generateAndValidate({
    promptContext,
    userMessage,
    session,
    personaOverlay,
  });

  // Step 8: Persist transcript (synchronous)
  const nextTurnIndex = (context.recentTurns[context.recentTurns.length - 1]?.turnIndex ?? -1) + 1;
  const userMsgId = uuidv4();
  const assistantMsgId = uuidv4();

  await db.insert(chatMessages).values([
    {
      id: userMsgId,
      sessionId,
      turnIndex: nextTurnIndex,
      role: "user",
      content: userMessage,
      validatorResult: null,
    },
    {
      id: assistantMsgId,
      sessionId,
      turnIndex: nextTurnIndex + 1,
      role: "assistant",
      content: result.content,
      validatorResult: result.validatorResult as unknown as Record<string, unknown>,
    },
  ]);

  // Step 9: Update session_state (synchronous)
  await upsertSessionState(sessionId, {
    derivedState: context.derivedState,
    lastTurnIndex: nextTurnIndex + 1,
  });

  // Update session.updated_at
  await db
    .update(chatSessions)
    .set({ updatedAt: new Date() })
    .where(eq(chatSessions.sessionId, sessionId));

  // Step 10 is handled by the caller (return below)

  // Step 11: Async post-turn work (fire-and-forget; awaited on graceful shutdown)
  const shouldWriteMemory = session.writebackPolicy !== "no_writeback";
  postTurnRunner.enqueue({
    sessionId,
    userMessage,
    assistantReply: result.content,
    session,
    memories: context.memories,
    derivedState: context.derivedState,
    shouldWriteMemory,
  });

  return {
    assistantMessageId: assistantMsgId,
    content: result.content,
    wasRewritten: result.wasRewritten,
    wasDeflected: result.wasDeflected,
    turnIndex: nextTurnIndex + 1,
  };
}

export const runCharacterTurn = traceStage(
  "orchestration.run_character_turn",
  _runCharacterTurn,
);

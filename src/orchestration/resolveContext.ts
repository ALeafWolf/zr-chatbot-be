import { embedText } from "../llm/embedText";
import { resolveContinuityScope } from "../retrieval/resolveContinuityScope";
import { retrieveInteractiveMemories } from "../retrieval/retrieveInteractiveMemories";
import { retrieveCanonNarrative } from "../retrieval/retrieveCanonNarrative";
import { getRecentConversationWindow } from "../retrieval/getRecentConversationWindow";
import {
  computeDerivedState,
  getSessionState,
  type DerivedState,
} from "../state/sessionStateRepo";
import type { ChatSession } from "../db/schema/chat";
import type { CharacterDefaults } from "../character/characterDefaults";
import type { MemoryNamespace } from "../memory/memoryNamespace";
import type { RetrievedMemory } from "../retrieval/retrieveInteractiveMemories";
import type { RetrievedCanonChunk } from "../retrieval/retrieveCanonNarrative";
import type { ConversationTurn } from "../retrieval/getRecentConversationWindow";
import { traceStage } from "../observability/langsmithTracing";
import { getSessionSummary, type SessionSummaryRecord } from "../memory/sessionSummaryRepo";
import { recentConversationWindowStartTurn } from "../memory/recentWindowBoundary";
import { retrieveSessionMemoryChunksTraced } from "../retrieval/retrieveSessionMemoryChunks";
import type { RetrievedSessionMemoryChunk } from "../retrieval/retrieveSessionMemoryChunks";

export interface ResolvedContext {
  memories: RetrievedMemory[];
  canonChunks: RetrievedCanonChunk[];
  recentTurns: ConversationTurn[];
  derivedState: DerivedState;
  queryEmbedding: number[];
  sessionSummary: SessionSummaryRecord;
  sessionRecall: RetrievedSessionMemoryChunk[];
}

const tracedRetrieveMemories = traceStage("retrieval.interactive_memories", retrieveInteractiveMemories);
const tracedRetrieveCanon = traceStage("retrieval.canon_narrative", retrieveCanonNarrative);
const tracedRetrieveTurns = traceStage("retrieval.recent_turns", getRecentConversationWindow);
const tracedSessionSummary = traceStage("retrieval.session_summary", getSessionSummary);
const tracedSessionStateRow = traceStage(
  "retrieval.session_state",
  async (sessionId: string) => getSessionState(sessionId),
);

/**
 * Parallel retrieval + session summary + derived_state (§7).
 */
export async function resolveContext(input: {
  session: ChatSession;
  userMessage: string;
  characterDefaults: CharacterDefaults;
}): Promise<ResolvedContext> {
  const { session, userMessage, characterDefaults } = input;

  const scopeResolution = resolveContinuityScope(
    session.continuityScope,
    session.continuityFamily as "main_world" | "au",
  );

  const queryEmbedding = await embedText(userMessage);

  const [memories, canonChunks, recentTurns, sessionSummary, sessionStateRow] =
    await Promise.all([
      tracedRetrieveMemories({
        queryEmbedding,
        memoryNamespace: session.memoryNamespace as MemoryNamespace,
        characterId: session.characterId,
      }),
      tracedRetrieveCanon({
        queryEmbedding,
        characterId: session.characterId,
        arcKeys: scopeResolution.arcKeys,
      }),
      tracedRetrieveTurns(session.sessionId),
      tracedSessionSummary(session.sessionId),
      tracedSessionStateRow(session.sessionId),
    ]);

  let latestFrontierTurn = sessionStateRow?.lastTurnIndex ?? -1;
  if (latestFrontierTurn < 0 && recentTurns.length > 0) {
    latestFrontierTurn =
      recentTurns[recentTurns.length - 1]?.turnIndex ?? -1;
  }

  const recentWindowStartTurn = recentConversationWindowStartTurn(
    latestFrontierTurn,
  );

  const sessionRecall =
    latestFrontierTurn >= 0
      ? await retrieveSessionMemoryChunksTraced({
          queryEmbedding,
          sessionId: session.sessionId,
          characterId: session.characterId,
          exclusiveRecentWindowFirstTurn: recentWindowStartTurn,
          latestFrontierTurnIndex: latestFrontierTurn,
        })
      : [];

  const derivedState = computeDerivedState(
    recentTurns.length,
    userMessage,
    characterDefaults,
  );

  return {
    memories,
    canonChunks,
    recentTurns,
    derivedState,
    queryEmbedding,
    sessionSummary,
    sessionRecall,
  };
}

import { embedText } from "../llm/embedText";
import { resolveContinuityScope } from "../retrieval/resolveContinuityScope";
import { retrieveInteractiveMemories } from "../retrieval/retrieveInteractiveMemories";
import { retrieveCanonNarrative } from "../retrieval/retrieveCanonNarrative";
import { getRecentConversationWindow } from "../retrieval/getRecentConversationWindow";
import { computeDerivedState } from "../state/sessionStateRepo";
import type { ChatSession } from "../db/schema/chat";
import type { CharacterDefaults } from "../character/characterDefaults";
import type { MemoryNamespace } from "../memory/memoryNamespace";
import type { RetrievedMemory } from "../retrieval/retrieveInteractiveMemories";
import type { RetrievedCanonChunk } from "../retrieval/retrieveCanonNarrative";
import type { ConversationTurn } from "../retrieval/getRecentConversationWindow";
import type { DerivedState } from "../state/sessionStateRepo";
import { traceStage } from "../observability/langsmithTracing";
import { getSessionSummary, type SessionSummaryRecord } from "../memory/sessionSummaryRepo";

export interface ResolvedContext {
  memories: RetrievedMemory[];
  canonChunks: RetrievedCanonChunk[];
  recentTurns: ConversationTurn[];
  derivedState: DerivedState;
  queryEmbedding: number[];
  sessionSummary: SessionSummaryRecord;
}

const tracedRetrieveMemories = traceStage("retrieval.interactive_memories", retrieveInteractiveMemories);
const tracedRetrieveCanon = traceStage("retrieval.canon_narrative", retrieveCanonNarrative);
const tracedRetrieveTurns = traceStage("retrieval.recent_turns", getRecentConversationWindow);
const tracedSessionSummary = traceStage("retrieval.session_summary", getSessionSummary);

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

  const [memories, canonChunks, recentTurns, sessionSummary] = await Promise.all([
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
  ]);

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
  };
}

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

export interface ResolvedContext {
  memories: RetrievedMemory[];
  canonChunks: RetrievedCanonChunk[];
  recentTurns: ConversationTurn[];
  derivedState: DerivedState;
  queryEmbedding: number[];
}

const tracedRetrieveMemories = traceStage("retrieval.interactive_memories", retrieveInteractiveMemories);
const tracedRetrieveCanon = traceStage("retrieval.canon_narrative", retrieveCanonNarrative);
const tracedRetrieveTurns = traceStage("retrieval.recent_turns", getRecentConversationWindow);

/**
 * Parallel retrieval + derived_state computation (§7 steps 3–4).
 * All three retrieval calls are fired concurrently.
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

  const [memories, canonChunks, recentTurns] = await Promise.all([
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
  ]);

  const derivedState = computeDerivedState(
    recentTurns.length,
    userMessage,
    characterDefaults,
  );

  return { memories, canonChunks, recentTurns, derivedState, queryEmbedding };
}

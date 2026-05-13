import { embedText } from "../llm/embedText";
import { resolveContinuityScope } from "../retrieval/resolveContinuityScope";
import { retrieveInteractiveMemories } from "../retrieval/retrieveInteractiveMemories";
import {
  canonScenesToChunks,
  retrieveCanonNarrativeLegacy,
  retrieveCanonCoarseToFine,
} from "../retrieval/retrieveCanonNarrative";
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
import type { RetrievedCanonScene } from "../retrieval/retrieveCanonTier3Pipeline";
import type { ConversationTurn } from "../retrieval/getRecentConversationWindow";
import { traceStage } from "../observability/langsmithTracing";
import { getSessionSummary, type SessionSummaryRecord } from "../memory/sessionSummaryRepo";
import { recentConversationWindowStartTurn } from "../memory/recentWindowBoundary";
import { retrieveSessionMemoryChunksTraced } from "../retrieval/retrieveSessionMemoryChunks";
import type { RetrievedSessionMemoryChunk } from "../retrieval/retrieveSessionMemoryChunks";
import {
  retrieveStructMemEntriesTraced,
  type RetrievedStructMemEntry,
} from "../retrieval/retrieveStructMemEntries";
import { env } from "../config/env";
import { rewriteQuery, type QueryRewriteResult } from "../retrieval/rewriteQuery";

export interface ResolvedContext {
  memories: RetrievedMemory[];
  canonChunks: RetrievedCanonChunk[];
  canonScenes: RetrievedCanonScene[];
  recentTurns: ConversationTurn[];
  derivedState: DerivedState;
  queryEmbedding: number[];
  /** Embedding used for coarse-to-fine canon (rewritten string when Tier 3). */
  canonQueryEmbedding: number[];
  sessionSummary: SessionSummaryRecord;
  sessionRecall: RetrievedSessionMemoryChunk[];
  /** StructMem Phase 1: extracted entries before the raw recent window. */
  structMemEntries: RetrievedStructMemEntry[];
  queryRewrite: QueryRewriteResult;
}

const tracedRetrieveMemories = traceStage("retrieval.interactive_memories", retrieveInteractiveMemories);
const tracedRetrieveCanonLeg = traceStage(
  "retrieval.canon_narrative",
  retrieveCanonNarrativeLegacy,
);
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

  const queryRewrite = await rewriteQuery(userMessage);

  let queryEmbedding: number[];
  let canonQueryEmbedding: number[];

  if (env.CANON_RETRIEVAL_PIPELINE === "tier1") {
    if (env.USE_REWRITTEN_QUERY_FOR_MEMORY_EMBEDDING) {
      queryEmbedding = await embedText(
        queryRewrite.combined_for_embedding.trim() || userMessage,
      );
      canonQueryEmbedding = await embedText(userMessage);
    } else {
      queryEmbedding = await embedText(userMessage);
      canonQueryEmbedding = queryEmbedding;
    }
  } else {
    const memoryText = env.USE_REWRITTEN_QUERY_FOR_MEMORY_EMBEDDING
      ? queryRewrite.combined_for_embedding.trim() || userMessage
      : userMessage;
    const canonText = queryRewrite.combined_for_embedding.trim() || userMessage;
    [queryEmbedding, canonQueryEmbedding] = await Promise.all([
      embedText(memoryText),
      embedText(canonText),
    ]);
  }

  let hypotheticalQueryEmbedding: number[] | undefined;
  if (
    env.CANON_QUERY_HYDE &&
    env.CANON_RETRIEVAL_PIPELINE === "tier3" &&
    queryRewrite.hypothetical?.trim()
  ) {
    hypotheticalQueryEmbedding = await embedText(queryRewrite.hypothetical.trim());
  }

  const [memories, canonChunksTier1, canonScenesTier3, recentTurns, sessionSummary, sessionStateRow] =
    await Promise.all([
      tracedRetrieveMemories({
        queryEmbedding,
        memoryNamespace: session.memoryNamespace as MemoryNamespace,
        characterId: session.characterId,
      }),
      env.CANON_RETRIEVAL_PIPELINE === "tier1"
        ? tracedRetrieveCanonLeg({
            queryEmbedding: canonQueryEmbedding,
            userMessage,
            characterId: session.characterId,
            arcKeys: scopeResolution.arcKeys,
          })
        : Promise.resolve([] as RetrievedCanonChunk[]),
      env.CANON_RETRIEVAL_PIPELINE === "tier3"
        ? retrieveCanonCoarseToFine({
            canonQueryEmbedding,
            hypotheticalQueryEmbedding,
            userMessage,
            characterId: session.characterId,
            arcKeys: scopeResolution.arcKeys,
            entities: queryRewrite.entities,
          })
        : Promise.resolve([] as RetrievedCanonScene[]),
      tracedRetrieveTurns(session.sessionId),
      tracedSessionSummary(session.sessionId),
      tracedSessionStateRow(session.sessionId),
    ]);

  let canonScenes: RetrievedCanonScene[] = canonScenesTier3;
  let canonChunks: RetrievedCanonChunk[] = canonChunksTier1;

  if (env.CANON_RETRIEVAL_PIPELINE === "tier3") {
    canonChunks = canonScenesToChunks(canonScenes);
  }

  let latestFrontierTurn = sessionStateRow?.lastTurnIndex ?? -1;
  if (latestFrontierTurn < 0 && recentTurns.length > 0) {
    latestFrontierTurn =
      recentTurns[recentTurns.length - 1]?.turnIndex ?? -1;
  }

  const recentWindowStartTurn = recentConversationWindowStartTurn(
    latestFrontierTurn,
  );

  const [sessionRecall, structMemEntries] =
    latestFrontierTurn >= 0
      ? await Promise.all([
          retrieveSessionMemoryChunksTraced({
            queryEmbedding,
            sessionId: session.sessionId,
            characterId: session.characterId,
            exclusiveRecentWindowFirstTurn: recentWindowStartTurn,
            latestFrontierTurnIndex: latestFrontierTurn,
          }),
          env.STRUCTMEM_ENABLED
            ? retrieveStructMemEntriesTraced({
                queryEmbedding,
                sessionId: session.sessionId,
                characterId: session.characterId,
                exclusiveRecentWindowFirstTurn: recentWindowStartTurn,
                latestFrontierTurnIndex: latestFrontierTurn,
              })
            : Promise.resolve([] as RetrievedStructMemEntry[]),
        ])
      : [[], []];

  const derivedState = computeDerivedState(
    recentTurns.length,
    userMessage,
    characterDefaults,
  );

  return {
    memories,
    canonChunks,
    canonScenes,
    recentTurns,
    derivedState,
    queryEmbedding,
    canonQueryEmbedding,
    sessionSummary,
    sessionRecall,
    structMemEntries,
    queryRewrite,
  };
}

import { embedText } from "../llm/embeddings/embedText";
import { resolveContinuityScope } from "../retrieval/scope/resolveContinuityScope";
import { retrieveInteractiveMemories } from "../retrieval/memory/retrieveInteractiveMemories";
import {
  canonScenesToChunks,
  retrieveCanonNarrativeLegacy,
  retrieveCanonCoarseToFine,
} from "../retrieval/canon/retrieveCanonNarrative";
import { getRecentConversationWindow } from "../retrieval/conversation/getRecentConversationWindow";
import {
  computeDerivedState,
  getSessionState,
  type DerivedState,
} from "../state/sessionStateRepo";
import type { ChatSession } from "../db/schema/chat";
import type { CharacterDefaults } from "../character/characterDefaults";
import type { MemoryNamespace } from "../memory/shared/memoryNamespace";
import type { RetrievedMemory } from "../retrieval/memory/retrieveInteractiveMemories";
import type { RetrievedCanonChunk } from "../retrieval/canon/retrieveCanonNarrative";
import type { RetrievedCanonScene } from "../retrieval/canon/retrieveCanonTier3Pipeline";
import type { ConversationTurn } from "../retrieval/conversation/getRecentConversationWindow";
import {
  traceStage,
  traceStageWithIO,
} from "../observability/langsmithTracing";
import { getSessionSummary, type SessionSummaryRecord } from "../memory/session/sessionSummaryRepo";
import { recentConversationWindowStartTurn } from "../retrieval/conversation/recentConversationBoundary";
import { retrieveSessionMemoryChunksTraced } from "../retrieval/memory/retrieveSessionMemoryChunks";
import type { RetrievedSessionMemoryChunk } from "../retrieval/memory/retrieveSessionMemoryChunks";
import {
  retrieveStructMemEntriesTraced,
  type RetrievedStructMemEntry,
} from "../retrieval/memory/retrieveStructMemEntries";
import {
  retrieveStructMemConsolidationsTraced,
  type RetrievedStructMemConsolidation,
} from "../retrieval/memory/retrieveStructMemConsolidations";
import {
  retrieveOpenThreadsTraced,
  type RetrievedOpenThread,
} from "../retrieval/memory/retrieveOpenThreads";
import { env } from "../config/env";
import {
  annotationHeuristicFallback,
  rewriteQuery,
  shouldUseAnnotationFallback,
  type QueryRewriteResult,
} from "../retrieval/query/rewriteQuery";
import { buildRetrievalQueryTexts } from "../retrieval/query/retrievalQueryTexts";
import { fuseById } from "./retrievalFusion";
import {
  retrieveOlderRecall,
  shouldRetrieveStructMemConsolidations,
} from "./olderRecall";

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
  /** StructMem Phase 3: synthesized current-session memory before the raw recent window. */
  structMemConsolidations: RetrievedStructMemConsolidation[];
  openThreads: RetrievedOpenThread[];
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
const tracedRetrievalDiagnostics = traceStageWithIO(
  "retrieval.context_diagnostics",
  async (input: Record<string, unknown>) => input,
  {
    tags: ["retrieval", "diagnostics"],
    processOutputs: (outputs) => outputs,
  },
);

function scoreMemory(memory: RetrievedMemory): number {
  return (
    memory.cosineSimilarity +
    memory.importanceScore * 0.1 +
    memory.emotionScore * 0.05
  );
}

function fuseMemories(
  primary: RetrievedMemory[],
  secondary: RetrievedMemory[],
): RetrievedMemory[] {
  return fuseById(primary, secondary, {
    getId: (item) => item.id,
    getScore: scoreMemory,
  });
}

function fuseSessionRecall(
  primary: RetrievedSessionMemoryChunk[],
  secondary: RetrievedSessionMemoryChunk[],
): RetrievedSessionMemoryChunk[] {
  return fuseById(primary, secondary, {
    getId: (item) => item.id,
    getScore: (item) => item.finalScore,
  });
}

function fuseStructMemEntries(
  primary: RetrievedStructMemEntry[],
  secondary: RetrievedStructMemEntry[],
): RetrievedStructMemEntry[] {
  return fuseById(primary, secondary, {
    getId: (item) => item.id,
    getScore: (item) => item.finalScore,
  });
}

function fuseStructMemConsolidations(
  primary: RetrievedStructMemConsolidation[],
  secondary: RetrievedStructMemConsolidation[],
): RetrievedStructMemConsolidation[] {
  return fuseById(primary, secondary, {
    getId: (item) => item.id,
    getScore: (item) => item.finalScore,
  });
}

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
  const queryTextAnnotationFallback =
    shouldUseAnnotationFallback(queryRewrite) ||
    annotationHeuristicFallback(userMessage, queryRewrite);
  const queryTexts = buildRetrievalQueryTexts({
    userMessage,
    queryRewrite,
    options: {
      annotationFallback: queryTextAnnotationFallback,
      confidenceThreshold: env.REWRITE_CONFIDENCE_THRESHOLD,
    },
  });
  const useFusedMemoryQuery =
    queryTexts.shouldFuseRawMemory &&
    queryTexts.rawText.trim() !== queryTexts.memoryText.trim();

  let queryEmbedding: number[];
  let canonQueryEmbedding: number[];
  let rawMemoryQueryEmbedding: number[] | undefined;

  if (env.CANON_RETRIEVAL_PIPELINE === "tier1") {
    [queryEmbedding, canonQueryEmbedding, rawMemoryQueryEmbedding] =
      await Promise.all([
        embedText(queryTexts.memoryText),
        embedText(queryTexts.canonText),
        useFusedMemoryQuery
          ? embedText(queryTexts.rawText)
          : Promise.resolve(undefined),
      ]);
  } else {
    [queryEmbedding, canonQueryEmbedding, rawMemoryQueryEmbedding] =
      await Promise.all([
        embedText(queryTexts.memoryText),
        embedText(queryTexts.canonText),
        useFusedMemoryQuery
          ? embedText(queryTexts.rawText)
          : Promise.resolve(undefined),
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
      useFusedMemoryQuery && rawMemoryQueryEmbedding
        ? Promise.all([
            tracedRetrieveMemories({
              queryEmbedding,
              memoryNamespace: session.memoryNamespace as MemoryNamespace,
              characterId: session.characterId,
            }),
            tracedRetrieveMemories({
              queryEmbedding: rawMemoryQueryEmbedding,
              memoryNamespace: session.memoryNamespace as MemoryNamespace,
              characterId: session.characterId,
            }),
          ]).then(([primary, secondary]) =>
            fuseMemories(primary, secondary),
          )
        : tracedRetrieveMemories({
            queryEmbedding,
            memoryNamespace: session.memoryNamespace as MemoryNamespace,
            characterId: session.characterId,
          }),
      env.CANON_RETRIEVAL_PIPELINE === "tier1"
        ? tracedRetrieveCanonLeg({
            queryEmbedding: canonQueryEmbedding,
            userMessage: queryTexts.canonText,
            characterId: session.characterId,
            arcKeys: scopeResolution.arcKeys,
          })
        : Promise.resolve([] as RetrievedCanonChunk[]),
      env.CANON_RETRIEVAL_PIPELINE === "tier3"
        ? retrieveCanonCoarseToFine({
            canonQueryEmbedding,
            hypotheticalQueryEmbedding,
            userMessage: queryTexts.canonText,
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

  const retrieveStructMemConsolidations =
    shouldRetrieveStructMemConsolidations({
      structMemEnabled: env.STRUCTMEM_ENABLED,
      structMemConsolidationEnabled: env.STRUCTMEM_CONSOLIDATION_ENABLED,
      structMemCrossSessionRetrievalEnabled:
        env.STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED,
    });

  const primaryOlderRecall = await retrieveOlderRecall(
    {
      queryEmbedding,
      sessionId: session.sessionId,
      characterId: session.characterId,
      memoryNamespace: session.memoryNamespace,
      exclusiveRecentWindowFirstTurn: recentWindowStartTurn,
      latestFrontierTurnIndex: latestFrontierTurn,
      structMemEnabled: env.STRUCTMEM_ENABLED,
      retrieveStructMemConsolidations,
    },
    {
      sessionMemoryChunks: retrieveSessionMemoryChunksTraced,
      structMemEntries: retrieveStructMemEntriesTraced,
      structMemConsolidations: retrieveStructMemConsolidationsTraced,
    },
  );

  const secondaryOlderRecall =
    useFusedMemoryQuery && rawMemoryQueryEmbedding
      ? await retrieveOlderRecall(
          {
            queryEmbedding: rawMemoryQueryEmbedding,
            sessionId: session.sessionId,
            characterId: session.characterId,
            memoryNamespace: session.memoryNamespace,
            exclusiveRecentWindowFirstTurn: recentWindowStartTurn,
            latestFrontierTurnIndex: latestFrontierTurn,
            structMemEnabled: env.STRUCTMEM_ENABLED,
            retrieveStructMemConsolidations,
          },
          {
            sessionMemoryChunks: retrieveSessionMemoryChunksTraced,
            structMemEntries: retrieveStructMemEntriesTraced,
            structMemConsolidations: retrieveStructMemConsolidationsTraced,
          },
        )
      : undefined;

  const sessionRecall = secondaryOlderRecall
    ? fuseSessionRecall(
        primaryOlderRecall.sessionRecall,
        secondaryOlderRecall.sessionRecall,
      )
    : primaryOlderRecall.sessionRecall;
  const structMemEntries = secondaryOlderRecall
    ? fuseStructMemEntries(
        primaryOlderRecall.structMemEntries,
        secondaryOlderRecall.structMemEntries,
      )
    : primaryOlderRecall.structMemEntries;
  const structMemConsolidations = secondaryOlderRecall
    ? fuseStructMemConsolidations(
        primaryOlderRecall.structMemConsolidations,
        secondaryOlderRecall.structMemConsolidations,
      )
    : primaryOlderRecall.structMemConsolidations;

  const openThreads =
    latestFrontierTurn >= 0
      ? await retrieveOpenThreadsTraced({
          sessionId: session.sessionId,
          characterId: session.characterId,
          sessionSummary,
          structMemEnabled: env.STRUCTMEM_ENABLED,
          exclusiveRecentWindowFirstTurn: recentWindowStartTurn,
          latestFrontierTurnIndex: latestFrontierTurn,
        })
      : [];

  await tracedRetrievalDiagnostics({
    memoryQueryMode: useFusedMemoryQuery ? "fused" : "single",
    rewriteConfidence: queryRewrite.confidence ?? null,
    annotationFallback: queryTextAnnotationFallback,
    openThreadCount: openThreads.length,
    sessionRecallCount: sessionRecall.length,
    structMemEntryCount: structMemEntries.length,
    structMemConsolidationCount: structMemConsolidations.length,
  });

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
    structMemConsolidations,
    openThreads,
    queryRewrite,
  };
}

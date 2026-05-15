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
import {
  retrieveStructMemEntryContextExpansionsTraced,
  type StructMemEntryContextExpansion,
} from "../retrieval/memory/retrieveStructMemEntryContextExpansions";
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
  olderRecallExclusiveFirstTurn,
  OLDER_RECALL_RECENT_OVERLAP_TURNS,
  retrieveOlderRecall,
  shouldRetrieveStructMemConsolidations,
} from "./olderRecall";
import {
  buildRetrievalPlan,
  type RetrievalPlan,
} from "./retrievalPlan";
import { selectPromptMemoryContext } from "./promptMemoryContextSelector";
import {
  readFreshTurnDelta,
  type LatestTurnDelta,
} from "./turnDelta";
import { buildRetrievalDiagnosticsPayload } from "./retrievalDiagnostics";
import {
  buildRetrievalEmbeddingRequests,
  runRetrievalEmbeddingBatch,
} from "./retrievalEmbeddingBatch";
import {
  retrieveActiveCorrections,
  type MemoryCorrectionContext,
} from "./memoryCorrections";

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
  structMemEntryContextExpansions: StructMemEntryContextExpansion[];
  /** StructMem Phase 3: synthesized current-session memory before the raw recent window. */
  structMemConsolidations: RetrievedStructMemConsolidation[];
  openThreads: RetrievedOpenThread[];
  memoryCorrections: MemoryCorrectionContext[];
  latestTurnDelta: LatestTurnDelta | null;
  queryRewrite: QueryRewriteResult;
  retrievalPlan: RetrievalPlan;
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
    subsystem: "retrieval",
    turn: "foreground",
    processOutputs: (outputs) => outputs,
  },
);
const tracedPromptMemorySelector = traceStageWithIO(
  "retrieval.prompt_context_selector",
  async (input: Parameters<typeof selectPromptMemoryContext>[0]) =>
    selectPromptMemoryContext(input),
  {
    subsystem: "retrieval",
    turn: "foreground",
    processInputs: (inputs) => {
      const input = inputs as unknown as Parameters<
        typeof selectPromptMemoryContext
      >[0];
      return {
        memoryCount: input.memories.length,
        sessionRecallCount: input.sessionRecall.length,
        structMemEntryCount: input.structMemEntries.length,
        structMemConsolidationCount: input.structMemConsolidations.length,
        openThreadCount: input.openThreads.length,
        recentTurnCount: input.recentTurns.length,
        retrievalPlan: {
          intent: input.retrievalPlan.intent,
          canonMode: input.retrievalPlan.canonMode,
          broadFailOpen: input.retrievalPlan.broadFailOpen,
        },
      };
    },
    processOutputs: (outputs) => {
      const output = outputs as unknown as ReturnType<
        typeof selectPromptMemoryContext
      >;
      return output.diagnostics as unknown as Record<string, unknown>;
    },
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
  const startedAt = Date.now();
  let queryRewriteMs = 0;
  let embeddingsMs = 0;
  let mainRetrievalMs = 0;
  let olderRecallMs = 0;
  let openThreadsMs = 0;
  let selectorMs = 0;

  const scopeResolution = resolveContinuityScope(
    session.continuityScope,
    session.continuityFamily as "main_world" | "au",
  );

  const queryRewriteStartedAt = Date.now();
  const queryRewrite = await rewriteQuery(userMessage);
  queryRewriteMs = Date.now() - queryRewriteStartedAt;
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
  const retrievalPlan = buildRetrievalPlan({
    queryRewrite,
    userMessage,
    annotationFallback: queryTextAnnotationFallback,
    confidenceThreshold: env.REWRITE_CONFIDENCE_THRESHOLD,
    structMemEntryDefaultTopK: env.STRUCTMEM_ENTRY_RETRIEVAL_TOP_K,
    structMemConsolidationDefaultTopK: 4,
  });
  const useFusedMemoryQuery =
    queryTexts.shouldFuseRawMemory &&
    queryTexts.rawText.trim() !== queryTexts.memoryText.trim();

  let queryEmbedding: number[];
  let canonQueryEmbedding: number[];
  let rawMemoryQueryEmbedding: number[] | undefined;
  let hypotheticalQueryEmbedding: number[] | undefined;

  const embeddingsStartedAt = Date.now();
  const embeddingRequests = buildRetrievalEmbeddingRequests({
    memoryText: queryTexts.memoryText,
    canonText: queryTexts.canonText,
    rawText: queryTexts.rawText,
    useFusedMemoryQuery,
    hydeEnabled: env.CANON_QUERY_HYDE,
    canonTier3: env.CANON_RETRIEVAL_PIPELINE === "tier3",
    hypothetical: queryRewrite.hypothetical,
  });
  ({
    queryEmbedding,
    canonQueryEmbedding,
    rawMemoryQueryEmbedding,
    hypotheticalQueryEmbedding,
  } = await runRetrievalEmbeddingBatch({
    requests: embeddingRequests,
  }));
  embeddingsMs = Date.now() - embeddingsStartedAt;

  const mainRetrievalStartedAt = Date.now();
  const [memories, canonChunksTier1, canonScenesTier3, recentTurns, sessionSummary, sessionStateRow] =
    await Promise.all([
      useFusedMemoryQuery && rawMemoryQueryEmbedding
        ? Promise.all([
            tracedRetrieveMemories({
              queryEmbedding,
              memoryNamespace: session.memoryNamespace as MemoryNamespace,
              characterId: session.characterId,
              limit: retrievalPlan.durableMemoryTopK,
            }),
            tracedRetrieveMemories({
              queryEmbedding: rawMemoryQueryEmbedding,
              memoryNamespace: session.memoryNamespace as MemoryNamespace,
              characterId: session.characterId,
              limit: retrievalPlan.durableMemoryTopK,
            }),
          ]).then(([primary, secondary]) =>
            fuseMemories(primary, secondary),
          )
        : tracedRetrieveMemories({
            queryEmbedding,
            memoryNamespace: session.memoryNamespace as MemoryNamespace,
            characterId: session.characterId,
            limit: retrievalPlan.durableMemoryTopK,
          }),
      env.CANON_RETRIEVAL_PIPELINE === "tier1" &&
      retrievalPlan.canonMode !== "skip"
        ? tracedRetrieveCanonLeg({
            queryEmbedding: canonQueryEmbedding,
            userMessage: queryTexts.canonText,
            characterId: session.characterId,
            arcKeys: scopeResolution.arcKeys,
            anchorTopK: retrievalPlan.canonMode === "compact" ? 2 : undefined,
          })
        : Promise.resolve([] as RetrievedCanonChunk[]),
      env.CANON_RETRIEVAL_PIPELINE === "tier3" &&
      retrievalPlan.canonMode !== "skip"
        ? retrieveCanonCoarseToFine({
            canonQueryEmbedding,
            hypotheticalQueryEmbedding,
            userMessage: queryTexts.canonText,
            characterId: session.characterId,
            arcKeys: scopeResolution.arcKeys,
            entities: queryRewrite.entities,
            tier3Overrides:
              retrievalPlan.canonMode === "compact"
                ? {
                    canonAnchorSceneTopK: 2,
                    canonMaxTotalUnits: 40,
                    canonMaxUnitsPerScene: 24,
                  }
                : undefined,
          })
        : Promise.resolve([] as RetrievedCanonScene[]),
      tracedRetrieveTurns(session.sessionId),
      tracedSessionSummary(session.sessionId),
      tracedSessionStateRow(session.sessionId),
    ]);
  mainRetrievalMs = Date.now() - mainRetrievalStartedAt;

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
  const olderRecallExclusiveFirst = olderRecallExclusiveFirstTurn(
    recentWindowStartTurn,
  );

  const retrieveStructMemConsolidations =
    shouldRetrieveStructMemConsolidations({
      structMemEnabled: env.STRUCTMEM_ENABLED,
      structMemConsolidationEnabled: env.STRUCTMEM_CONSOLIDATION_ENABLED,
      structMemCrossSessionRetrievalEnabled:
        env.STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED,
    });

  const olderRecallStartedAt = Date.now();
  const [primaryOlderRecall, secondaryOlderRecall] = await Promise.all([
    retrieveOlderRecall(
      {
        queryEmbedding,
        sessionId: session.sessionId,
        characterId: session.characterId,
        memoryNamespace: session.memoryNamespace,
        exclusiveRecentWindowFirstTurn: olderRecallExclusiveFirst,
        latestFrontierTurnIndex: latestFrontierTurn,
        structMemEnabled: env.STRUCTMEM_ENABLED,
        retrieveStructMemConsolidations,
        sessionRecallLimit: retrievalPlan.sessionRecallTopK,
        structMemEntryLimit: retrievalPlan.structMemEntryTopK,
        structMemConsolidationLimit:
          retrievalPlan.structMemConsolidationTopK,
      },
      {
        sessionMemoryChunks: retrieveSessionMemoryChunksTraced,
        structMemEntries: retrieveStructMemEntriesTraced,
        structMemConsolidations: retrieveStructMemConsolidationsTraced,
      },
    ),
    useFusedMemoryQuery && rawMemoryQueryEmbedding
      ? retrieveOlderRecall(
          {
            queryEmbedding: rawMemoryQueryEmbedding,
            sessionId: session.sessionId,
            characterId: session.characterId,
            memoryNamespace: session.memoryNamespace,
            exclusiveRecentWindowFirstTurn: olderRecallExclusiveFirst,
            latestFrontierTurnIndex: latestFrontierTurn,
            structMemEnabled: env.STRUCTMEM_ENABLED,
            retrieveStructMemConsolidations,
            sessionRecallLimit: retrievalPlan.sessionRecallTopK,
            structMemEntryLimit: retrievalPlan.structMemEntryTopK,
            structMemConsolidationLimit:
              retrievalPlan.structMemConsolidationTopK,
          },
          {
            sessionMemoryChunks: retrieveSessionMemoryChunksTraced,
            structMemEntries: retrieveStructMemEntriesTraced,
            structMemConsolidations: retrieveStructMemConsolidationsTraced,
          },
        )
      : Promise.resolve(undefined),
  ]);
  olderRecallMs = Date.now() - olderRecallStartedAt;

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

  const openThreadsStartedAt = Date.now();
  const openThreads =
    latestFrontierTurn >= 0
      ? await retrieveOpenThreadsTraced({
          sessionId: session.sessionId,
          characterId: session.characterId,
          sessionSummary,
          structMemEnabled: env.STRUCTMEM_ENABLED,
          exclusiveRecentWindowFirstTurn: recentWindowStartTurn,
          latestFrontierTurnIndex: latestFrontierTurn,
          limit: retrievalPlan.openThreadTopK,
        })
      : [];
  openThreadsMs = Date.now() - openThreadsStartedAt;

  const derivedState = computeDerivedState(
    recentTurns.length,
    userMessage,
    characterDefaults,
  );
  const memoryCorrections = retrieveActiveCorrections(sessionSummary);
  const latestTurnDelta = readFreshTurnDelta(sessionStateRow, latestFrontierTurn);
  const selectorStartedAt = Date.now();
  const selectedContext = await tracedPromptMemorySelector({
    memories,
    sessionRecall,
    structMemEntries,
    structMemConsolidations,
    openThreads,
    recentTurns,
    retrievalPlan,
    memoryCorrections,
  });
  selectorMs = Date.now() - selectorStartedAt;
  const structMemEntryExpansion =
    selectedContext.structMemEntries.length > 0
      ? await retrieveStructMemEntryContextExpansionsTraced({
          sessionId: session.sessionId,
          entries: selectedContext.structMemEntries,
        })
      : {
          expansions: [] as StructMemEntryContextExpansion[],
          diagnostics: {
            eligibleCount: 0,
            expandedCount: 0,
            droppedByBudgetCount: 0,
          },
        };

  await tracedRetrievalDiagnostics(
    buildRetrievalDiagnosticsPayload({
      retrievalPlan,
      memoryQueryMode: useFusedMemoryQuery ? "fused" : "single",
      rewriteConfidence: queryRewrite.confidence ?? null,
      annotationFallback: queryTextAnnotationFallback,
      boundaryOverlapTurns: OLDER_RECALL_RECENT_OVERLAP_TURNS,
      olderRecallExclusiveFirstTurn: olderRecallExclusiveFirst,
      latestTurnDeltaActive: latestTurnDelta !== null,
      structMemEntryExpansion: structMemEntryExpansion.diagnostics,
      timingsMs: {
        queryRewriteMs,
        embeddingsMs,
        mainRetrievalMs,
        olderRecallMs,
        openThreadsMs,
        selectorMs,
        totalResolveContextMs: Date.now() - startedAt,
      },
      selectionDiagnostics: selectedContext.diagnostics,
    }),
  );

  return {
    memories: selectedContext.memories,
    canonChunks,
    canonScenes,
    recentTurns,
    derivedState,
    queryEmbedding,
    canonQueryEmbedding,
    sessionSummary,
    sessionRecall: selectedContext.sessionRecall,
    structMemEntries: selectedContext.structMemEntries,
    structMemEntryContextExpansions: structMemEntryExpansion.expansions,
    structMemConsolidations: selectedContext.structMemConsolidations,
    openThreads: selectedContext.openThreads,
    memoryCorrections,
    latestTurnDelta,
    queryRewrite,
    retrievalPlan,
  };
}

import { resolveContinuityScope } from "../../retrieval/scope/resolveContinuityScope";
import { retrieveInteractiveMemories } from "../../retrieval/memory/retrieveInteractiveMemories";
import {
  canonScenesToChunks,
  retrieveCanonNarrativeLegacy,
  retrieveCanonCoarseToFine,
} from "../../retrieval/canon/retrieveCanonNarrative";
import {
  getLatestConversationRouteTurnIndex,
  getRecentConversationWindow,
} from "../../retrieval/conversation/getRecentConversationWindow";
import {
  computeDerivedState,
  getSessionState,
  type DerivedState,
} from "../../state/sessionStateRepo";
import type { ChatSession } from "../../db/schema/chat";
import type { CharacterDefaults } from "../../character/characterDefaults";
import type { MemoryNamespace } from "../../memory/shared/memoryNamespace";
import type { RetrievedMemory } from "../../retrieval/memory/retrieveInteractiveMemories";
import type { RetrievedCanonChunk } from "../../retrieval/canon/retrieveCanonNarrative";
import type { RetrievedCanonScene } from "../../retrieval/canon/retrieveCanonTier3Pipeline";
import type { ConversationTurn } from "../../retrieval/conversation/getRecentConversationWindow";
import {
  traceStage,
  traceStageWithIO,
} from "../../observability/langsmithTracing";
import { getSessionSummary, type SessionSummaryRecord } from "../../memory/session/sessionSummaryRepo";
import { recentConversationWindowStartTurn } from "../../retrieval/conversation/recentConversationBoundary";
import { retrieveSessionMemoryChunksTraced } from "../../retrieval/memory/retrieveSessionMemoryChunks";
import type { RetrievedSessionMemoryChunk } from "../../retrieval/memory/retrieveSessionMemoryChunks";
import {
  retrieveStructMemEntriesTraced,
  type RetrievedStructMemEntry,
} from "../../retrieval/memory/retrieveStructMemEntries";
import {
  retrieveStructMemConsolidationsTraced,
  type RetrievedStructMemConsolidation,
} from "../../retrieval/memory/retrieveStructMemConsolidations";
import {
  retrieveOpenThreadsTraced,
  type RetrievedOpenThread,
} from "../../retrieval/memory/retrieveOpenThreads";
import {
  retrieveStructMemEntryContextExpansionsTraced,
  type StructMemEntryContextExpansion,
} from "../../retrieval/memory/retrieveStructMemEntryContextExpansions";
import {
  tracedSearchInternalLogicEvidence,
  type InternalLogicEvidenceHit,
} from "../../retrieval/internalLogic/searchInternalLogicEvidence";
import { env } from "../../config/env";
import {
  annotationHeuristicFallback,
  rewriteQuery,
  shouldUseAnnotationFallback,
  type QueryRewriteResult,
} from "../../retrieval/query/rewriteQuery";
import { buildRetrievalQueryTexts } from "../../retrieval/query/retrievalQueryTexts";
import { fuseById } from "../retrieval/retrievalFusion";
import {
  olderRecallExclusiveFirstTurn,
  OLDER_RECALL_RECENT_OVERLAP_TURNS,
  retrieveOlderRecall,
  shouldRetrieveStructMemConsolidations,
} from "./olderRecall";
import {
  buildRetrievalPlan,
  classifyTurnType,
  type RetrievalPlan,
  summarizeContextNeedForTrace,
} from "../retrieval/retrievalPlan";
import { ROLEPLAY_TURN_ROUTE } from "../turn/turnRoutes";
import { selectPromptMemoryContext as selectPromptMemoryContextStatic } from "./promptMemoryContextSelector";
import { planContext, type ContextPlannerOutput } from "./contextPlanner";
import {
  buildPromptContextCandidates,
  type ContextCandidate,
  type CandidateShortlist,
  type ContextCandidateSource,
  applyCandidateSelection,
  filterCanonBySelection,
} from "./contextCandidates";
import { rerankCandidates, type MemoryRerankOutput } from "../retrieval/memoryRerank";
import { rerankContext } from "./rerankContext";
import {
  readFreshTurnDelta,
  formatTurnDelta,
  type LatestTurnDelta,
} from "../turn/turnDelta";
import {
  buildRecallThoughtContext,
  type RecallThoughtContext,
} from "./recallThoughtContext";
import { buildRetrievalDiagnosticsPayload } from "../retrieval/retrievalDiagnostics";
import {
  buildRetrievalEmbeddingRequests,
  runRetrievalEmbeddingBatch,
} from "../retrieval/retrievalEmbeddingBatch";
import {
  retrieveActiveCorrections,
  type MemoryCorrectionContext,
} from "./memoryCorrections";
import {
  createEmptyEvalSourceIds,
  recordRetrievalSnapshot,
  type EvalMemorySource,
} from "../../eval/evalSnapshots";
import { readRerankVariant } from "../../eval/experimentVariants";
import {
  detectMotifSignal,
  shouldProbeStructMemMotif,
  buildMotifQueries,
} from "./detectMotifSignal";
import { z } from "zod";
import type { MotifSignal, StructMemMotifProbeSummary } from "./motifTypes";

export interface ResolvedContext {
  memories: RetrievedMemory[];
  canonChunks: RetrievedCanonChunk[];
  canonScenes: RetrievedCanonScene[];
  recentTurns: ConversationTurn[];
  derivedState: DerivedState;
  queryEmbedding: number[];
  /** Internal-logic evidence hits retrieved and selected for this turn. */
  internalLogicEvidence?: InternalLogicEvidenceHit[];
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
  turnType: import("../retrieval/retrievalPlan").TurnType;
  motifSignal?: MotifSignal;
  motifProbe?: StructMemMotifProbeSummary;
  rerankOutput?: MemoryRerankOutput | null;
  recallThoughtContext: RecallThoughtContext;
  /** True when there are no prior roleplay messages for this session. */
  isFirstUserTurn: boolean;
}

/** Runtime Zod schema for ResolvedContext — structural check on required top-level keys.
 * Full recursive validation of nested types (RetrievedMemory, etc.) is out of scope;
 * .passthrough() allows optional fields (motifSignal, rerankOutput, etc.). */
export const ResolvedContextSchema = z.object({
  memories: z.array(z.unknown()),
  canonChunks: z.array(z.unknown()),
  canonScenes: z.array(z.unknown()),
  recentTurns: z.array(z.unknown()),
  derivedState: z.record(z.unknown()),
  queryEmbedding: z.array(z.number()),
  internalLogicEvidence: z.array(z.unknown()).optional(),
  canonQueryEmbedding: z.array(z.number()),
  sessionSummary: z.unknown(),
  sessionRecall: z.array(z.unknown()),
  structMemEntries: z.array(z.unknown()),
  structMemEntryContextExpansions: z.array(z.unknown()),
  structMemConsolidations: z.array(z.unknown()),
  openThreads: z.array(z.unknown()),
  memoryCorrections: z.array(z.unknown()),
  latestTurnDelta: z.unknown(),
  queryRewrite: z.record(z.unknown()),
  retrievalPlan: z.record(z.unknown()),
  turnType: z.string(),
  recallThoughtContext: z.record(z.unknown()),
  isFirstUserTurn: z.boolean(),
}).passthrough() as unknown as z.ZodType<ResolvedContext>;

/**
 * Pre-rerank retrieval context: everything built before the rerank/deterministic
 * fallback decision. Captures all values needed by the rerank adapter AND the
 * post-rerank assembly step.
 */
export interface PreRerankContext {
  session: ChatSession;
  userMessage: string;
  characterDefaults: CharacterDefaults;
  contextPlannerOutput: ContextPlannerOutput;
  queryRewrite: QueryRewriteResult;
  queryRewriteMs: number;
  queryTextAnnotationFallback: boolean;
  retrievalPlan: RetrievalPlan;
  queryEmbedding: number[];
  canonQueryEmbedding: number[];
  hypotheticalQueryEmbedding: number[] | undefined;
  motifQueryEmbeddings: number[][] | undefined;
  memories: RetrievedMemory[];
  canonChunks: RetrievedCanonChunk[];
  canonScenes: RetrievedCanonScene[];
  recentTurns: ConversationTurn[];
  sessionSummary: SessionSummaryRecord;
  sessionStateRow: Record<string, unknown> | null;
  latestRoleplayTurnIndex: number | null;
  isFirstUserTurn: boolean;
  sessionRecall: RetrievedSessionMemoryChunk[];
  structMemEntries: RetrievedStructMemEntry[];
  structMemConsolidations: RetrievedStructMemConsolidation[];
  openThreads: RetrievedOpenThread[];
  motifSignal?: MotifSignal;
  motifProbe?: StructMemMotifProbeSummary;
  internalLogicEvidence?: InternalLogicEvidenceHit[];
  derivedState: DerivedState;
  memoryCorrections: MemoryCorrectionContext[];
  latestTurnDelta: LatestTurnDelta | null;
  shortlist: CandidateShortlist;
  shortlistMs: number;
  latestTurnDeltaText: string | undefined;
  motifProbeText: string | undefined;
  startedAt: number;
  embeddingsMs: number;
  mainRetrievalMs: number;
  olderRecallMs: number;
  openThreadsMs: number;
  olderRecallExclusiveFirst: number;
  useFusedMemoryQuery: boolean;
  latestFrontierTurn: number;
}

/**
 * Assemble the final ResolvedContext from pre-rerank retrieval context and the
 * rerank/deterministic-fallback result.
 *
 * Performs StructMem entry context expansion, retrieval diagnostics tracing,
 * eval snapshot recording, recall thought context construction, and final
 * ResolvedContext assembly.
 *
 * This is a cycle-free seam: it depends only on PreRerankContext and
 * RerankContextOutput, not on resolveContext(...) itself.
 */
export async function assembleResolvedContext(
  pre: PreRerankContext,
  rerankResult: import("./rerankContext").RerankContextOutput,
  deps?: {
    traceRetrievalDiagnostics?: typeof tracedRetrievalDiagnostics;
  },
): Promise<ResolvedContext> {
  const {
    session,
    userMessage,
    characterDefaults,
    queryRewrite,
    retrievalPlan,
    queryRewriteMs,
    queryTextAnnotationFallback,
    memories,
    sessionRecall,
    structMemEntries,
    structMemConsolidations,
    openThreads,
    canonChunks: preCanonChunks,
    canonScenes: preCanonScenes,
    sessionSummary,
    latestTurnDelta,
    memoryCorrections,
    motifSignal,
    motifProbe,
    internalLogicEvidence: preInternalLogicEvidence,
    queryEmbedding,
    canonQueryEmbedding,
    hypotheticalQueryEmbedding,
    derivedState,
    shortlistMs,
    latestTurnDeltaText,
    motifProbeText,
    startedAt,
    embeddingsMs,
    mainRetrievalMs,
    olderRecallMs,
    openThreadsMs,
    olderRecallExclusiveFirst,
    useFusedMemoryQuery,
    isFirstUserTurn,
  } = pre;

  const {
    selectedContext,
    rerankOutput,
    rerankFallbackUsed,
    rerankFallbackReason,
    rerankMs,
    selectorFallbackMs,
    canonChunks: filteredCanonChunks,
    canonScenes: filteredCanonScenes,
    filteredSessionSummary,
    filteredLatestTurnDelta,
    filteredMemoryCorrections,
  } = rerankResult;

  const selectorMs = shortlistMs + rerankMs + (selectorFallbackMs ?? 0);
  const totalMs = Date.now() - startedAt;

  const doTrace = deps?.traceRetrievalDiagnostics ?? tracedRetrievalDiagnostics;

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

  await doTrace(
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
        totalResolveContextMs: totalMs,
        shortlistMs,
        rerankMs,
        selectorFallbackMs: selectorFallbackMs ?? 0,
      },
      selectionDiagnostics: selectedContext.diagnostics,
      rerank: rerankOutput
        ? {
            selectedCount: rerankOutput.selected.length,
            rejectedCount: rerankOutput.rejected.length,
            finalContextMode: rerankOutput.finalContextMode,
            needsEvidenceFallback: rerankOutput.needsEvidenceFallback,
            ...(rerankOutput.resolutionDiagnostics && {
              resolution: rerankOutput.resolutionDiagnostics,
            }),
          }
        : {
            fallbackUsed: true,
            fallbackReason: rerankFallbackReason ?? "unknown",
          },
    }),
  );

  const retrieved = createEmptyEvalSourceIds();
  retrieved.interactive_memory = memories.map((m) => m.id);
  retrieved.session_chunk = sessionRecall.map((c) => c.id);
  retrieved.structmem_entry = structMemEntries.map((e) => e.id);
  retrieved.structmem_consolidation = structMemConsolidations.map((c) => c.id);
  retrieved.open_thread = openThreads.map((t) => t.id);
  retrieved.canon =
    filteredCanonScenes.length > 0
      ? filteredCanonScenes.map((s) => s.sceneId)
      : filteredCanonChunks.map((c) => c.sceneId ?? c.id);

  const injected = createEmptyEvalSourceIds();
  injected.interactive_memory = selectedContext.memories.map((m) => m.id);
  injected.session_chunk = selectedContext.sessionRecall.map((c) => c.id);
  injected.structmem_entry = selectedContext.structMemEntries.map((e) => e.id);
  injected.structmem_consolidation =
    selectedContext.structMemConsolidations.map((c) => c.id);
  injected.open_thread = selectedContext.openThreads.map((t) => t.id);
  injected.canon =
    filteredCanonScenes.length > 0
      ? filteredCanonScenes.map((s) => s.sceneId)
      : filteredCanonChunks.map((c) => c.sceneId ?? c.id);

  const currentRerankVariant = readRerankVariant();

  recordRetrievalSnapshot({
    query: {
      rawUserMessage: userMessage,
      intent: queryRewrite.intent,
      confidence: queryRewrite.confidence ?? null,
      hydeUsed: Boolean(hypotheticalQueryEmbedding),
      rawFusionUsed: useFusedMemoryQuery,
    },
    retrieved,
    injected,
    dropped: {
      duplicate: selectedContext.diagnostics.droppedDuplicateCount,
      lowScore: selectedContext.diagnostics.droppedLowScoreCount,
      correctionConflict: selectedContext.diagnostics.droppedCorrectionCount,
      sourceBudget: selectedContext.diagnostics.droppedBudgetCount,
      other: 0,
    },
    topSources: selectedContext.diagnostics.topSources.map((source) => ({
      source: source as EvalMemorySource,
    })),
    timingsMs: {
      queryRewriteMs,
      embeddingsMs,
      mainRetrievalMs,
      olderRecallMs,
      openThreadsMs,
      selectorMs,
      totalResolveContextMs: totalMs,
    },
    ...(rerankOutput
      ? {
          rerank: {
            enabled: true,
            candidateIds: createEmptyEvalSourceIds(),
            selected: rerankOutput.selected.map((s) => ({
              source: s.source as EvalMemorySource | "canon" | "session_summary",
              id: s.id,
              relevance: s.relevance,
              usageInstruction: s.usageInstruction,
              reasonCode: s.reasonCode,
            })),
            rejectedCount: rerankOutput.rejected.length,
            finalContextMode: rerankOutput.finalContextMode,
            needsEvidenceFallback: rerankOutput.needsEvidenceFallback,
            rerankVariant: currentRerankVariant,
            fallbackReason: rerankFallbackReason ?? undefined,
          },
        }
      : {
          rerank: {
            enabled: false,
            candidateIds: createEmptyEvalSourceIds(),
            selected: [],
            rejectedCount: 0,
            finalContextMode: "recent_only",
            needsEvidenceFallback: false,
            fallbackUsed: true,
            rerankVariant: currentRerankVariant,
            fallbackReason: rerankFallbackReason ?? "variant_deterministic_only",
          },
        }),
  });

  return {
    memories: selectedContext.memories,
    canonChunks: filteredCanonChunks,
    canonScenes: filteredCanonScenes,
    recentTurns: pre.recentTurns,
    derivedState,
    queryEmbedding,
    canonQueryEmbedding,
    sessionSummary: filteredSessionSummary,
    sessionRecall: selectedContext.sessionRecall,
    structMemEntries: selectedContext.structMemEntries,
    structMemEntryContextExpansions: structMemEntryExpansion.expansions,
    structMemConsolidations: selectedContext.structMemConsolidations,
    openThreads: selectedContext.openThreads,
    memoryCorrections: filteredMemoryCorrections,
    latestTurnDelta: filteredLatestTurnDelta,
    queryRewrite,
    retrievalPlan,
    turnType: classifyTurnType(retrievalPlan, userMessage, queryRewrite),
    motifSignal,
    motifProbe,
    internalLogicEvidence: selectedContext.internalLogicEvidence,
    rerankOutput,
    isFirstUserTurn,
    recallThoughtContext: buildRecallThoughtContext({
      memories: selectedContext.memories,
      sessionRecall: selectedContext.sessionRecall,
      structMemEntries: selectedContext.structMemEntries,
      structMemConsolidations: selectedContext.structMemConsolidations,
      openThreads: selectedContext.openThreads,
      canonChunks: filteredCanonChunks,
      canonScenes: filteredCanonScenes,
      sessionSummary: filteredSessionSummary,
      latestTurnDelta: filteredLatestTurnDelta,
      memoryCorrections: filteredMemoryCorrections,
      rerankOutput,
    }),
  };
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
  async (input: Parameters<typeof selectPromptMemoryContextStatic>[0]) =>
    selectPromptMemoryContextStatic(input),
  {
    subsystem: "retrieval",
    turn: "foreground",
    processInputs: (inputs) => {
      const input = inputs as unknown as Parameters<
        typeof selectPromptMemoryContextStatic
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
          contextNeed: summarizeContextNeedForTrace(
            input.retrievalPlan.contextNeed,
          ),
        },
      };
    },
    processOutputs: (outputs) => {
      const output = outputs as unknown as ReturnType<
        typeof selectPromptMemoryContextStatic
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
 * Build the pre-rerank retrieval context: query planning, embeddings, parallel
 * retrieval, older recall fusion, motif probing, candidate shortlist, and all
 * timing fields. Returns a PreRerankContext that can be passed to both
 * `rerankContext(...)` and `assembleResolvedContext(...)`.
 *
 * Extracted from `resolveContext(...)` so this step can run as a standalone
 * graph node in the pre-generation graph.
 */
export async function buildPreRerankContext(input: {
  session: ChatSession;
  userMessage: string;
  characterDefaults: CharacterDefaults;
}): Promise<PreRerankContext> {
  const { session, userMessage, characterDefaults } = input;
  const startedAt = Date.now();
  let queryRewriteMs = 0;
  let embeddingsMs = 0;
  let mainRetrievalMs = 0;
  let olderRecallMs = 0;
  let openThreadsMs = 0;

  const scopeResolution = resolveContinuityScope(
    session.continuityScope,
    session.continuityFamily as "main_world" | "au",
  );

  const plannerStartedAt = Date.now();
  const contextPlannerOutput = await planContext(userMessage);
  const queryRewrite = contextPlannerOutput.queryRewrite;
  queryRewriteMs = Date.now() - plannerStartedAt;
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

  // Phase 1: Motif signal detection (deterministic, zero LLM calls)
  let motifSignal: MotifSignal | undefined;
  let motifProbe: StructMemMotifProbeSummary | undefined;
  let motifQueries: string[] | undefined;
  if (env.STRUCTMEM_MOTIF_PROBE_ENABLED) {
    motifSignal = detectMotifSignal({ queryRewrite, rawUserMessage: userMessage });
    if (shouldProbeStructMemMotif(motifSignal)) {
      motifQueries = buildMotifQueries(motifSignal);
    }
  }

  const retrievalPlan = buildRetrievalPlan({
    queryRewrite,
    userMessage,
    annotationFallback: queryTextAnnotationFallback,
    confidenceThreshold: env.REWRITE_CONFIDENCE_THRESHOLD,
    structMemEntryDefaultTopK: env.STRUCTMEM_ENTRY_RETRIEVAL_TOP_K,
    structMemConsolidationDefaultTopK: 4,
    motifSignal,
    motifProbe,
  });

  const useFusedMemoryQuery =
    queryTexts.shouldFuseRawMemory &&
    queryTexts.rawText.trim() !== queryTexts.memoryText.trim();

  let queryEmbedding: number[];
  let canonQueryEmbedding: number[];
  let rawMemoryQueryEmbedding: number[] | undefined;
  let hypotheticalQueryEmbedding: number[] | undefined;
  let motifQueryEmbeddings: number[][] | undefined;

  const embeddingsStartedAt = Date.now();
  const embeddingRequests = buildRetrievalEmbeddingRequests({
    memoryText: queryTexts.memoryText,
    canonText: queryTexts.canonText,
    rawText: queryTexts.rawText,
    useFusedMemoryQuery,
    hydeEnabled:
      env.CANON_QUERY_HYDE &&
      retrievalPlan.canonMode !== "skip",
    canonTier3: env.CANON_RETRIEVAL_PIPELINE === "tier3",
    hypothetical: queryRewrite.hypothetical,
    motifQueries,
  });
  ({
    queryEmbedding,
    canonQueryEmbedding,
    rawMemoryQueryEmbedding,
    hypotheticalQueryEmbedding,
    motifQueryEmbeddings,
  } = await runRetrievalEmbeddingBatch({ requests: embeddingRequests }));
  embeddingsMs = Date.now() - embeddingsStartedAt;

  const mainRetrievalStartedAt = Date.now();
  const [
    memories,
    canonChunksTier1,
    canonScenesTier3,
    recentTurns,
    sessionSummary,
    sessionStateRow,
    latestRoleplayTurnIndex,
  ] = await Promise.all([
    useFusedMemoryQuery && rawMemoryQueryEmbedding
      ? Promise.all([
          tracedRetrieveMemories({ queryEmbedding, memoryNamespace: session.memoryNamespace as MemoryNamespace, characterId: session.characterId, limit: retrievalPlan.durableMemoryTopK }),
          tracedRetrieveMemories({ queryEmbedding: rawMemoryQueryEmbedding, memoryNamespace: session.memoryNamespace as MemoryNamespace, characterId: session.characterId, limit: retrievalPlan.durableMemoryTopK }),
        ]).then(([primary, secondary]) => fuseMemories(primary, secondary))
      : tracedRetrieveMemories({ queryEmbedding, memoryNamespace: session.memoryNamespace as MemoryNamespace, characterId: session.characterId, limit: retrievalPlan.durableMemoryTopK }),
    env.CANON_RETRIEVAL_PIPELINE === "tier1" && retrievalPlan.canonMode !== "skip"
      ? tracedRetrieveCanonLeg({ queryEmbedding: canonQueryEmbedding, userMessage: queryTexts.canonText, characterId: session.characterId, arcKeys: scopeResolution.arcKeys, anchorTopK: retrievalPlan.canonMode === "compact" ? 2 : undefined })
      : Promise.resolve([] as RetrievedCanonChunk[]),
    env.CANON_RETRIEVAL_PIPELINE === "tier3" && retrievalPlan.canonMode !== "skip"
      ? retrieveCanonCoarseToFine({ canonQueryEmbedding, hypotheticalQueryEmbedding, userMessage: queryTexts.canonText, characterId: session.characterId, arcKeys: scopeResolution.arcKeys, entities: queryRewrite.entities, tier3Overrides: retrievalPlan.canonMode === "compact" ? { canonAnchorSceneTopK: 2, canonMaxTotalUnits: 40, canonMaxUnitsPerScene: 24 } : undefined })
      : Promise.resolve([] as RetrievedCanonScene[]),
    tracedRetrieveTurns(session.sessionId, undefined, ROLEPLAY_TURN_ROUTE),
    tracedSessionSummary(session.sessionId),
    tracedSessionStateRow(session.sessionId),
    getLatestConversationRouteTurnIndex(session.sessionId, ROLEPLAY_TURN_ROUTE),
  ]);
  mainRetrievalMs = Date.now() - mainRetrievalStartedAt;

  let canonScenes: RetrievedCanonScene[] = canonScenesTier3;
  let canonChunks: RetrievedCanonChunk[] = canonChunksTier1;
  if (env.CANON_RETRIEVAL_PIPELINE === "tier3") {
    canonChunks = canonScenesToChunks(canonScenes);
  }

  let latestFrontierTurn = latestRoleplayTurnIndex ?? -1;
  if (latestFrontierTurn < 0 && recentTurns.length > 0) {
    latestFrontierTurn = recentTurns[recentTurns.length - 1]?.turnIndex ?? -1;
  }
  const isFirstUserTurn = latestRoleplayTurnIndex === null;
  const recentWindowStartTurn = recentConversationWindowStartTurn(latestFrontierTurn);
  const olderRecallExclusiveFirst = olderRecallExclusiveFirstTurn(recentWindowStartTurn);
  const shouldRetrieveConsolidations = shouldRetrieveStructMemConsolidations({
    structMemEnabled: env.STRUCTMEM_ENABLED,
    structMemConsolidationEnabled: env.STRUCTMEM_CONSOLIDATION_ENABLED,
    structMemCrossSessionRetrievalEnabled: env.STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED,
  });

  const olderRecallStartedAt = Date.now();
  const [primaryOlderRecall, secondaryOlderRecall] = await Promise.all([
    retrieveOlderRecall({ queryEmbedding, sessionId: session.sessionId, characterId: session.characterId, memoryNamespace: session.memoryNamespace, exclusiveRecentWindowFirstTurn: olderRecallExclusiveFirst, latestFrontierTurnIndex: latestFrontierTurn, structMemEnabled: env.STRUCTMEM_ENABLED, shouldRetrieveConsolidations, sessionRecallLimit: retrievalPlan.sessionRecallTopK, structMemEntryLimit: retrievalPlan.structMemEntryTopK, structMemConsolidationLimit: retrievalPlan.structMemConsolidationTopK }, { sessionMemoryChunks: retrieveSessionMemoryChunksTraced, structMemEntries: retrieveStructMemEntriesTraced, structMemConsolidations: retrieveStructMemConsolidationsTraced }),
    useFusedMemoryQuery && rawMemoryQueryEmbedding
      ? retrieveOlderRecall({ queryEmbedding: rawMemoryQueryEmbedding, sessionId: session.sessionId, characterId: session.characterId, memoryNamespace: session.memoryNamespace, exclusiveRecentWindowFirstTurn: olderRecallExclusiveFirst, latestFrontierTurnIndex: latestFrontierTurn, structMemEnabled: env.STRUCTMEM_ENABLED, shouldRetrieveConsolidations, sessionRecallLimit: retrievalPlan.sessionRecallTopK, structMemEntryLimit: retrievalPlan.structMemEntryTopK, structMemConsolidationLimit: retrievalPlan.structMemConsolidationTopK }, { sessionMemoryChunks: retrieveSessionMemoryChunksTraced, structMemEntries: retrieveStructMemEntriesTraced, structMemConsolidations: retrieveStructMemConsolidationsTraced })
      : Promise.resolve(undefined),
  ]);
  olderRecallMs = Date.now() - olderRecallStartedAt;

  const sessionRecall = secondaryOlderRecall ? fuseSessionRecall(primaryOlderRecall.sessionRecall, secondaryOlderRecall.sessionRecall) : primaryOlderRecall.sessionRecall;
  const structMemEntries = secondaryOlderRecall ? fuseStructMemEntries(primaryOlderRecall.structMemEntries, secondaryOlderRecall.structMemEntries) : primaryOlderRecall.structMemEntries;
  const structMemConsolidations = secondaryOlderRecall ? fuseStructMemConsolidations(primaryOlderRecall.structMemConsolidations, secondaryOlderRecall.structMemConsolidations) : primaryOlderRecall.structMemConsolidations;

  // Motif probe retrieval
  if (motifSignal && shouldProbeStructMemMotif(motifSignal) && motifQueryEmbeddings?.length) {
    const probeTopK = env.STRUCTMEM_MOTIF_PROBE_TOP_K;
    const probeMinScore = env.STRUCTMEM_MOTIF_PROBE_MIN_SCORE;
    const probeEmbedding = motifQueryEmbeddings[0]!;
    const [probeEntries, probeConsolidations] = await Promise.all([
      retrieveStructMemEntriesTraced({ queryEmbedding: probeEmbedding, sessionId: session.sessionId, characterId: session.characterId, exclusiveRecentWindowFirstTurn: olderRecallExclusiveFirst, latestFrontierTurnIndex: latestFrontierTurn, limit: probeTopK * 2 }),
      shouldRetrieveConsolidations ? retrieveStructMemConsolidationsTraced({ queryEmbedding: probeEmbedding, sessionId: session.sessionId, characterId: session.characterId, memoryNamespace: session.memoryNamespace, exclusiveRecentWindowFirstTurn: olderRecallExclusiveFirst, latestFrontierTurnIndex: latestFrontierTurn, limit: probeTopK }) : Promise.resolve([]),
    ]);
    const allMotifTerms = [
      ...motifSignal.bodyOrObjectTerms,
      ...motifSignal.actionTerms,
    ];

    const matchingEntries = probeEntries
      .filter((e) => {
        const lower = e.text.toLowerCase();
        return (
          allMotifTerms.some((t) => lower.includes(t)) &&
          e.cosineSimilarity >= probeMinScore
        );
      })
      .slice(0, probeTopK)
      .map((e) => ({
        entryId: e.id,
        entryType: e.entryType,
        text: e.text,
        turnIndex: e.turnIndex,
        score: e.finalScore,
        matchedTerms: allMotifTerms.filter((t) =>
          e.text.toLowerCase().includes(t),
        ),
      }));

    const matchingConsolidations = probeConsolidations
      .filter((c) =>
        allMotifTerms.some((t) => c.summaryText.toLowerCase().includes(t)),
      )
      .slice(0, probeTopK)
      .map((c) => ({
        id: c.id,
        summaryText: c.summaryText,
        turnStart: c.turnStart,
        turnEnd: c.turnEnd,
        score: c.finalScore,
      }));

    motifProbe = {
      hasStrongMatch: matchingEntries.length > 0,
      matchingEntries,
      matchingConsolidations,
      triggeredTerms: allMotifTerms.filter((t) =>
        matchingEntries.some((e) => e.text.toLowerCase().includes(t)),
      ),
    };
  }

  const openThreadsStartedAt = Date.now();
  const openThreads = latestFrontierTurn >= 0
    ? await retrieveOpenThreadsTraced({ sessionId: session.sessionId, characterId: session.characterId, sessionSummary, structMemEnabled: env.STRUCTMEM_ENABLED, exclusiveRecentWindowFirstTurn: recentWindowStartTurn, latestFrontierTurnIndex: latestFrontierTurn, limit: retrievalPlan.openThreadTopK })
    : [];
  openThreadsMs = Date.now() - openThreadsStartedAt;

  // Internal-logic evidence retrieval
  const internalLogicEvidence = queryEmbedding.length > 0 && env.INTERNAL_LOGIC_EVIDENCE_ENABLED
    ? await tracedSearchInternalLogicEvidence({
        characterId: session.characterId,
        queryEmbedding,
        continuityScope: session.continuityScope,
        arcKeys: scopeResolution.arcKeys,
      })
    : [];

  const derivedState = computeDerivedState(recentTurns.length, userMessage, characterDefaults);
  const memoryCorrections = retrieveActiveCorrections(sessionSummary);
  const latestTurnDelta = readFreshTurnDelta(sessionStateRow, latestFrontierTurn);
  const motifProbeText = motifProbe ? motifProbe.matchingEntries.slice(0, 3).map((e) => e.text).join(" | ") : undefined;
  const latestTurnDeltaText = latestTurnDelta ? formatTurnDelta(latestTurnDelta) : undefined;
  const selectorStartedAt = Date.now();
  const shortlist = buildPromptContextCandidates({
    memories, sessionRecall, structMemEntries, structMemConsolidations, openThreads, canonChunks, canonScenes, recentTurns,
    sessionSummaryText: sessionSummary?.summaryText ?? undefined, latestTurnDeltaText, memoryCorrections, motifProbeText,
    internalLogicEvidence,
    openThreadTopK: retrievalPlan.openThreadTopK, maxCandidates: env.MEMORY_RERANK_MAX_CANDIDATES,
  });

  return {
    session, userMessage, characterDefaults, contextPlannerOutput, queryRewrite, queryRewriteMs,
    queryTextAnnotationFallback, retrievalPlan, queryEmbedding, canonQueryEmbedding,
    hypotheticalQueryEmbedding, motifQueryEmbeddings, memories, canonChunks, canonScenes,
    recentTurns, sessionSummary, sessionStateRow, latestRoleplayTurnIndex, isFirstUserTurn,
    sessionRecall, structMemEntries, structMemConsolidations, openThreads, motifSignal, motifProbe,
    internalLogicEvidence,
    derivedState, memoryCorrections, latestTurnDelta, shortlist, shortlistMs: Date.now() - selectorStartedAt,
    latestTurnDeltaText, motifProbeText, startedAt, embeddingsMs, mainRetrievalMs, olderRecallMs,
    openThreadsMs, olderRecallExclusiveFirst, useFusedMemoryQuery, latestFrontierTurn,
  };
}

/**
 * Parallel retrieval + session summary + derived_state.
 *
 * Compatibility wrapper that delegates to buildPreRerankContext + rerankContext +
 * assembleResolvedContext. The public signature is unchanged.
 */
export async function resolveContext(input: {
  session: ChatSession;
  userMessage: string;
  characterDefaults: CharacterDefaults;
}): Promise<ResolvedContext> {
  const pre = await buildPreRerankContext(input);
  const rerankResult = await rerankContext({
    userMessage: pre.userMessage,
    structuredUserQuery: pre.contextPlannerOutput.structuredUserQuery,
    plannerIntent: pre.contextPlannerOutput.intent,
    plannerHints: pre.contextPlannerOutput.retrievalHints,
    recentTurns: pre.recentTurns,
    latestTurnDeltaText: pre.latestTurnDeltaText,
    continuityScope: pre.session.continuityScope,
    candidates: pre.shortlist.candidates,
    memories: pre.memories,
    sessionRecall: pre.sessionRecall,
    structMemEntries: pre.structMemEntries,
    structMemConsolidations: pre.structMemConsolidations,
    openThreads: pre.openThreads,
    canonChunks: pre.canonChunks,
    canonScenes: pre.canonScenes,
    sessionSummary: pre.sessionSummary,
    latestTurnDelta: pre.latestTurnDelta,
    memoryCorrections: pre.memoryCorrections,
    retrievalPlan: pre.retrievalPlan,
    internalLogicEvidence: pre.internalLogicEvidence,
  });
  return assembleResolvedContext(pre, rerankResult);
}

/**
 * Re-exported from `rerankContext` to break the circular dependency between
 * `rerankContext` (adapter) and `resolveContext` (orchestrator).
 *
 * The function was moved to `rerankContext.ts` so that both modules can
 * import it from the same cycle-free location. Existing unit tests that
 * import from `./resolveContext` continue to work via this re-export.
 */
export { preserveCriticalContext } from "./rerankContext";

import {
  rerankCandidates,
  type MemoryRerankOutput,
} from "../retrieval/memoryRerank";
import {
  applyCandidateSelection,
  filterCanonBySelection,
  type ContextCandidate,
} from "./contextCandidates";
import { selectPromptMemoryContextStatic, type PromptMemoryContextSelection } from "./promptMemoryContextSelector";
import type { ConversationTurn } from "../../retrieval/conversation/getRecentConversationWindow";
import type { RetrievedMemory } from "../../retrieval/memory/retrieveInteractiveMemories";
import type { RetrievedSessionMemoryChunk } from "../../retrieval/memory/retrieveSessionMemoryChunks";
import type { RetrievedStructMemEntry } from "../../retrieval/memory/retrieveStructMemEntries";
import type { RetrievedStructMemConsolidation } from "../../retrieval/memory/retrieveStructMemConsolidations";
import type { RetrievedOpenThread } from "../../retrieval/memory/retrieveOpenThreads";
import type { RetrievedCanonChunk } from "../../retrieval/canon/retrieveCanonNarrative";
import type { RetrievedCanonScene } from "../../retrieval/canon/retrieveCanonTier3Pipeline";
import type { MemoryCorrectionContext } from "./memoryCorrections";
import type { RetrievalPlan } from "../retrieval/retrievalPlan";
import type { SessionSummaryRecord } from "../../memory/session/sessionSummaryRepo";
import type { LatestTurnDelta } from "../turn/turnDelta";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RerankContextInput {
  userMessage: string;
  structuredUserQuery: {
    userSpeech?: string;
    userAction?: string;
    userThought?: string;
    replyDirection?: string;
  };
  plannerIntent:
    | "scene_continuation"
    | "explicit_recall"
    | "implicit_memory_callback"
    | "canon_question"
    | "relationship_state"
    | "real_world_info"
    | "mixed"
    | "unclear";
  plannerHints: {
    sourcePriority: Array<
      | "recent_chat"
      | "session_memory"
      | "structmem"
      | "structmem_consolidation"
      | "interactive_memory"
      | "canon"
      | "web"
    >;
    queryVariants: {
      memory: string[];
      structmem: string[];
      structmemConsolidation: string[];
      interactiveMemory: string[];
      canon: string[];
      web: string[];
    };
    possibleMotif: boolean;
    possibleCanonClaim: boolean;
    possibleOldMemoryReference: boolean;
    possibleDurableMemoryReference: boolean;
  };
  recentTurns: ConversationTurn[];
  latestTurnDeltaText?: string;
  continuityScope: string;
  candidates: ContextCandidate[];
  memories: RetrievedMemory[];
  sessionRecall: RetrievedSessionMemoryChunk[];
  structMemEntries: RetrievedStructMemEntry[];
  structMemConsolidations: RetrievedStructMemConsolidation[];
  openThreads: RetrievedOpenThread[];
  canonChunks: RetrievedCanonChunk[];
  canonScenes: RetrievedCanonScene[];
  sessionSummary: SessionSummaryRecord;
  latestTurnDelta: LatestTurnDelta | null;
  memoryCorrections: MemoryCorrectionContext[];
  retrievalPlan: RetrievalPlan;
}

export interface RerankContextOutput {
  selectedContext: PromptMemoryContextSelection;
  rerankOutput: MemoryRerankOutput | null;
  rerankFallbackUsed: boolean;
  rerankFallbackReason: string | null;
  /** Time spent in the reranker LLM call (0 when reranker was not called). */
  rerankMs: number;
  /** Time spent in the deterministic fallback selector (undefined when reranker succeeded). */
  selectorFallbackMs: number | undefined;
  canonChunks: RetrievedCanonChunk[];
  canonScenes: RetrievedCanonScene[];
  filteredSessionSummary: SessionSummaryRecord;
  filteredLatestTurnDelta: LatestTurnDelta | null;
  filteredMemoryCorrections: MemoryCorrectionContext[];
}

export interface RerankContextDeps {
  rerankCandidates?: typeof rerankCandidates;
  selectPromptMemoryContext?: typeof selectPromptMemoryContextStatic;
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Preserve deterministic control/continuity context that must survive regardless
 * of reranker selection. Memory corrections, session summary, and latest turn
 * delta are always preserved after a successful rerank.
 *
 * Extracted here to avoid a circular dependency between `rerankContext` (adapter)
 * and `resolveContext` (orchestrator). Both modules import this from the same
 * location.
 */
export function preserveCriticalContext(
  sessionSummary: SessionSummaryRecord | null,
  latestTurnDelta: LatestTurnDelta | null,
  memoryCorrections: MemoryCorrectionContext[],
): {
  filteredSessionSummary: SessionSummaryRecord | null;
  filteredLatestTurnDelta: LatestTurnDelta | null;
  filteredMemoryCorrections: MemoryCorrectionContext[];
} {
  return {
    filteredSessionSummary: sessionSummary,
    filteredLatestTurnDelta: latestTurnDelta,
    filteredMemoryCorrections: memoryCorrections,
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Run the roleplay memory-rerank selection step and fall back to deterministic
 * context selection when the LLM reranker fails or times out.
 *
 * This adapter owns the post-candidate-shortlist selection logic extracted from
 * `resolveContext(...)`. It does **not** own retrieval, candidate shortlist
 * construction, StructMem expansion, retrieval diagnostics, or eval snapshots.
 *
 * On the success path:
 *   rerankCandidates -> applyCandidateSelection -> preserveCriticalContext
 *     -> filterCanonBySelection -> return
 *
 * On the fallback path:
 *   selectPromptMemoryContextStatic (deterministic) -> return
 */
export async function rerankContext(
  input: RerankContextInput,
  deps?: RerankContextDeps,
): Promise<RerankContextOutput> {
  const doRerank = deps?.rerankCandidates ?? rerankCandidates;
  const doSelectDeterministic =
    deps?.selectPromptMemoryContext ?? selectPromptMemoryContextStatic;

  const recentChatDigest = input.recentTurns
    .slice(-4)
    .map((t) => `${t.role}: ${t.content}`)
    .join("\n");

  let selectedContext: PromptMemoryContextSelection;
  let rerankOutput: MemoryRerankOutput | null = null;
  let rerankFallbackUsed = false;
  let rerankFallbackReason: string | null = null;
  let rerankMs = 0;
  let selectorFallbackMs: number | undefined;
  let canonChunks = input.canonChunks;
  let canonScenes = input.canonScenes;
  let filteredSessionSummary = input.sessionSummary;
  let filteredLatestTurnDelta = input.latestTurnDelta;
  let filteredMemoryCorrections = input.memoryCorrections;

  try {
    const rerankResult = await doRerank({
      currentUserMessage: input.userMessage,
      structuredUserQuery: input.structuredUserQuery,
      plannerIntent: input.plannerIntent,
      plannerHints: input.plannerHints,
      recentChatDigest,
      latestTurnDelta: input.latestTurnDeltaText,
      relationshipState: input.continuityScope,
      continuityScope: input.continuityScope,
      candidates: input.candidates,
    });

    rerankMs = rerankResult.timingMs;

    if (!rerankResult.ok) {
      throw new Error(rerankResult.fallbackReason);
    }

    rerankOutput = rerankResult.output;

    const selected = applyCandidateSelection({
      shortlist: input.candidates,
      selectedIds: rerankOutput.selected.map((s) => s.id),
      memories: input.memories,
      sessionRecall: input.sessionRecall,
      structMemEntries: input.structMemEntries,
      structMemConsolidations: input.structMemConsolidations,
      openThreads: input.openThreads,
    });

    ({ filteredSessionSummary, filteredLatestTurnDelta, filteredMemoryCorrections } =
      preserveCriticalContext(
        input.sessionSummary,
        input.latestTurnDelta,
        input.memoryCorrections,
      ));

    const selectedCanonChunkIds = (rerankOutput.selected as { id: string; source: string }[])
      .filter((s) => s.source === "canon_chunk")
      .map((s) => s.id);
    const selectedCanonFactIds = (rerankOutput.selected as { id: string; source: string }[])
      .filter((s) => s.source === "canon_fact")
      .map((s) => s.id);
    const filteredCanon = filterCanonBySelection(
      input.canonChunks,
      input.canonScenes,
      selectedCanonChunkIds,
      selectedCanonFactIds,
    );
    canonChunks = filteredCanon.canonChunks;
    canonScenes = filteredCanon.canonScenes;

    selectedContext = {
      memories: selected.memories,
      sessionRecall: selected.sessionRecall,
      structMemEntries: selected.structMemEntries,
      structMemConsolidations: selected.structMemConsolidations,
      openThreads: selected.openThreads,
      diagnostics: {
        retrievedCounts: {
          interactive_memory: input.memories.length,
          session_chunk: input.sessionRecall.length,
          structmem_entry: input.structMemEntries.length,
          structmem_consolidation: input.structMemConsolidations.length,
          open_thread: input.openThreads.length,
        },
        injectedCounts: {
          interactive_memory: selected.memories.length,
          session_chunk: selected.sessionRecall.length,
          structmem_entry: selected.structMemEntries.length,
          structmem_consolidation: selected.structMemConsolidations.length,
          open_thread: selected.openThreads.length,
        },
        droppedDuplicateCount: 0,
        droppedLowScoreCount: 0,
        droppedCorrectionCount: 0,
        droppedBudgetCount: 0,
        topSources: [],
        averageInjectedScore: null,
      },
    };
  } catch (e) {
    rerankFallbackUsed = true;
    rerankFallbackReason =
      e instanceof Error ? e.message : "reranker_call_failed";
    rerankOutput = null;

    const fallbackStartedAt = Date.now();
    selectedContext = doSelectDeterministic({
      memories: input.memories,
      sessionRecall: input.sessionRecall,
      structMemEntries: input.structMemEntries,
      structMemConsolidations: input.structMemConsolidations,
      openThreads: input.openThreads,
      recentTurns: input.recentTurns,
      retrievalPlan: input.retrievalPlan,
      memoryCorrections: input.memoryCorrections,
    });
    selectorFallbackMs = Date.now() - fallbackStartedAt;
  }

  return {
    selectedContext,
    rerankOutput,
    rerankFallbackUsed,
    rerankFallbackReason,
    rerankMs,
    selectorFallbackMs,
    canonChunks,
    canonScenes,
    filteredSessionSummary,
    filteredLatestTurnDelta,
    filteredMemoryCorrections,
  };
}

// ---------------------------------------------------------------------------
// LLM rerank-only seam (for graph-visible conditional routing)
// ---------------------------------------------------------------------------

/**
 * Run only the LLM reranker step, without falling back to deterministic
 * selection. The pre-generation graph node calls this and routes to
 * `deterministicContextSelector` on failure.
 */
export async function runLlmRerank(
  input: RerankContextInput,
  deps?: RerankContextDeps,
): Promise<
  | {
      ok: true;
      rerankOutput: MemoryRerankOutput;
      selectedContext: PromptMemoryContextSelection;
      canonChunks: RetrievedCanonChunk[];
      canonScenes: RetrievedCanonScene[];
      filteredSessionSummary: SessionSummaryRecord;
      filteredLatestTurnDelta: LatestTurnDelta | null;
      filteredMemoryCorrections: MemoryCorrectionContext[];
      rerankMs: number;
    }
  | { ok: false; rerankMs: number; fallbackReason: string }
> {
  const doRerank = deps?.rerankCandidates ?? rerankCandidates;

  const recentChatDigest = input.recentTurns
    .slice(-4)
    .map((t) => `${t.role}: ${t.content}`)
    .join("\n");

  const rerankResult = await doRerank({
    currentUserMessage: input.userMessage,
    structuredUserQuery: input.structuredUserQuery,
    plannerIntent: input.plannerIntent,
    plannerHints: input.plannerHints,
    recentChatDigest,
    latestTurnDelta: input.latestTurnDeltaText,
    relationshipState: input.continuityScope,
    continuityScope: input.continuityScope,
    candidates: input.candidates,
  });

  if (!rerankResult.ok) {
    return { ok: false, rerankMs: rerankResult.timingMs, fallbackReason: rerankResult.fallbackReason };
  }

  const rerankOutput = rerankResult.output;
  const selected = applyCandidateSelection({
    shortlist: input.candidates,
    selectedIds: rerankOutput.selected.map((s) => s.id),
    memories: input.memories,
    sessionRecall: input.sessionRecall,
    structMemEntries: input.structMemEntries,
    structMemConsolidations: input.structMemConsolidations,
    openThreads: input.openThreads,
  });

  const { filteredSessionSummary, filteredLatestTurnDelta, filteredMemoryCorrections } =
    preserveCriticalContext(input.sessionSummary, input.latestTurnDelta, input.memoryCorrections);

  const selectedCanonChunkIds = (rerankOutput.selected as { id: string; source: string }[])
    .filter((s) => s.source === "canon_chunk")
    .map((s) => s.id);
  const selectedCanonFactIds = (rerankOutput.selected as { id: string; source: string }[])
    .filter((s) => s.source === "canon_fact")
    .map((s) => s.id);
  const filteredCanon = filterCanonBySelection(
    input.canonChunks,
    input.canonScenes,
    selectedCanonChunkIds,
    selectedCanonFactIds,
  );

  const selectedContext: PromptMemoryContextSelection = {
    memories: selected.memories,
    sessionRecall: selected.sessionRecall,
    structMemEntries: selected.structMemEntries,
    structMemConsolidations: selected.structMemConsolidations,
    openThreads: selected.openThreads,
    diagnostics: {
      retrievedCounts: {
        interactive_memory: input.memories.length,
        session_chunk: input.sessionRecall.length,
        structmem_entry: input.structMemEntries.length,
        structmem_consolidation: input.structMemConsolidations.length,
        open_thread: input.openThreads.length,
      },
      injectedCounts: {
        interactive_memory: selected.memories.length,
        session_chunk: selected.sessionRecall.length,
        structmem_entry: selected.structMemEntries.length,
        structmem_consolidation: selected.structMemConsolidations.length,
        open_thread: selected.openThreads.length,
      },
      droppedDuplicateCount: 0,
      droppedLowScoreCount: 0,
      droppedCorrectionCount: 0,
      droppedBudgetCount: 0,
      topSources: [],
      averageInjectedScore: null,
    },
  };

  return {
    ok: true,
    rerankOutput,
    selectedContext,
    canonChunks: filteredCanon.canonChunks,
    canonScenes: filteredCanon.canonScenes,
    filteredSessionSummary,
    filteredLatestTurnDelta,
    filteredMemoryCorrections,
    rerankMs: rerankResult.timingMs,
  };
}

// ---------------------------------------------------------------------------
// Deterministic selector seam (for graph-visible conditional routing)
// ---------------------------------------------------------------------------

/**
 * Run only the deterministic context selector, used as a fallback graph node
 * when the LLM reranker fails or times out.
 */
export async function runDeterministicSelector(
  input: RerankContextInput,
  deps?: Pick<RerankContextDeps, "selectPromptMemoryContext">,
): Promise<{
  selectedContext: PromptMemoryContextSelection;
  selectorFallbackMs: number;
}> {
  const doSelectDeterministic =
    deps?.selectPromptMemoryContext ?? selectPromptMemoryContextStatic;

  const startedAt = Date.now();
  const selectedContext = doSelectDeterministic({
    memories: input.memories,
    sessionRecall: input.sessionRecall,
    structMemEntries: input.structMemEntries,
    structMemConsolidations: input.structMemConsolidations,
    openThreads: input.openThreads,
    recentTurns: input.recentTurns,
    retrievalPlan: input.retrievalPlan,
    memoryCorrections: input.memoryCorrections,
  });

  return { selectedContext, selectorFallbackMs: Date.now() - startedAt };
}


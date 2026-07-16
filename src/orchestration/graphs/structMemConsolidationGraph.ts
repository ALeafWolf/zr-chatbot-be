import { StateGraph, START, END } from "@langchain/langgraph";
import { v4 as uuidv4 } from "uuid";
import {
  StructMemConsolidationGraphStateSchema,
  type StructMemConsolidationGraphState,
} from "../graphState/structMemConsolidationGraphState";
import type { StructMemConsolidationJob } from "../../db/schema/structmem";
import type { ChatSession } from "../../db/schema/chat";
import { embedText } from "../../llm/embeddings/embedText";
import { synthesizeStructMemConsolidation } from "../../memory/structmem/structmemConsolidationSynthesis";
import { maybeWriteCrossSessionStructMemConsolidations } from "../../memory/structmem/structmemConsolidationRepo";
import {
  loadConsolidationJobById,
  selectConsolidationBufferForGraph,
  markConsolidationJob,
  persistCurrentSessionConsolidation,
  loadChatSession,
} from "../../memory/structmem/structmemConsolidationRepo";
import type {
  SelectConsolidationBufferResult,
  PersistCurrentSessionConsolidationInput,
  PersistCurrentSessionConsolidationResult,
} from "../../memory/structmem/structmemConsolidationRepo";
import { env } from "../../config/env";

// ---------------------------------------------------------------------------
// Dependency injection shape
// ---------------------------------------------------------------------------

export interface StructMemConsolidationGraphDeps {
  loadJobFn: (jobId: string) => Promise<StructMemConsolidationJob | null>;
  selectBufferFn: (input: {
    sessionId: string;
    characterId: string;
  }) => Promise<SelectConsolidationBufferResult>;
  synthesizeFn: typeof synthesizeStructMemConsolidation;
  embedFn: typeof embedText;
  persistCurrentSessionFn: (
    input: PersistCurrentSessionConsolidationInput,
  ) => Promise<PersistCurrentSessionConsolidationResult>;
  loadSessionFn: (sessionId: string) => Promise<ChatSession | null>;
  writeCrossSessionFn: typeof maybeWriteCrossSessionStructMemConsolidations;
  markJobFn: (
    jobId: string,
    status: "completed" | "skipped",
  ) => Promise<void>;
  /** Max input tokens for the consolidation synthesis prompt. Defaults to env. */
  maxSynthesisInputTokens: number;
}

// ---------------------------------------------------------------------------
// Default production dependencies
// ---------------------------------------------------------------------------

export function defaultStructMemConsolidationGraphDeps(
  overrides?: Partial<StructMemConsolidationGraphDeps>,
): StructMemConsolidationGraphDeps {
  return {
    loadJobFn: overrides?.loadJobFn ?? loadConsolidationJobById,
    selectBufferFn:
      overrides?.selectBufferFn ??
      ((input) => selectConsolidationBufferForGraph(input)),
    synthesizeFn: overrides?.synthesizeFn ?? synthesizeStructMemConsolidation,
    embedFn: overrides?.embedFn ?? embedText,
    persistCurrentSessionFn:
      overrides?.persistCurrentSessionFn ?? persistCurrentSessionConsolidation,
    loadSessionFn: overrides?.loadSessionFn ?? loadChatSession,
    writeCrossSessionFn:
      overrides?.writeCrossSessionFn ??
      maybeWriteCrossSessionStructMemConsolidations,
    markJobFn: overrides?.markJobFn ?? markConsolidationJob,
    maxSynthesisInputTokens:
      overrides?.maxSynthesisInputTokens ?? Number(env.STRUCTMEM_MAX_SYNTHESIS_INPUT_TOKENS),
  };
}

// ---------------------------------------------------------------------------
// Graph factory
// ---------------------------------------------------------------------------

export function createStructMemConsolidationGraph(
  deps: StructMemConsolidationGraphDeps = defaultStructMemConsolidationGraphDeps(),
) {
  // ---- Node: loadClaimedConsolidationJob -----------------------------------

  async function loadClaimedConsolidationJobNode(
    state: StructMemConsolidationGraphState,
  ): Promise<Partial<StructMemConsolidationGraphState>> {
    try {
      const job = await deps.loadJobFn(state.jobId);
      if (!job) {
        return {
          errors: [
            {
              stage: "loadClaimedConsolidationJob",
              message: `consolidation job not found: ${state.jobId}`,
            },
          ],
          failureReason: "job_not_found",
        };
      }
      if (job.status !== "running") {
        return {
          errors: [
            {
              stage: "loadClaimedConsolidationJob",
              message: `job ${state.jobId} status is "${job.status}", expected "running"`,
            },
          ],
          failureReason: "job_not_running",
        };
      }
      return { job };
    } catch (err) {
      return {
        errors: [
          {
            stage: "loadClaimedConsolidationJob",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
        failureReason: "job_not_found",
      };
    }
  }

  // ---- Node: selectConsolidationBuffer -------------------------------------

  async function selectConsolidationBufferNode(
    state: StructMemConsolidationGraphState,
  ): Promise<Partial<StructMemConsolidationGraphState>> {
    if (!state.job) return {};
    try {
      const result = await deps.selectBufferFn({
        sessionId: state.job.sessionId,
        characterId: state.job.characterId,
      });

      if (result.bufferEntries.length === 0) {
        return {
          bufferCount: 0,
          semanticSeedCount: 0,
          sourceEventCount: 0,
          selectedEntryCount: 0,
          turnStart: null,
          turnEnd: null,
          skippedReason: result.skippedReason ?? "empty_buffer",
          finalStatus: "skipped",
        };
      }

      const allEntries = [
        ...result.bufferEntries,
        ...result.semanticSeedEntries,
      ];
      const uniqueEventIds = new Set(allEntries.map((e: any) => e.eventId));

      return {
        bufferEntries: result.bufferEntries as any,
        semanticSeedEntries: result.semanticSeedEntries as any,
        bufferCount: result.bufferCount,
        semanticSeedCount: result.semanticSeedCount,
        sourceEventCount: uniqueEventIds.size,
        selectedEntryCount: allEntries.length,
        turnStart: result.turnStart,
        turnEnd: result.turnEnd,
      };
    } catch (err) {
      return {
        errors: [
          {
            stage: "selectConsolidationBuffer",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
        failureReason: "insufficient_candidates",
      };
    }
  }

  // ---- Node: synthesizeCurrentSessionConsolidation -------------------------

  async function synthesizeCurrentSessionConsolidationNode(
    state: StructMemConsolidationGraphState,
  ): Promise<Partial<StructMemConsolidationGraphState>> {
    if (
      !state.bufferEntries ||
      state.bufferEntries.length === 0
    )
      return {};
    try {
      const synthesis = await deps.synthesizeFn({
        bufferEntries: state.bufferEntries as any,
        semanticSeedEntries: (state.semanticSeedEntries ?? []) as any,
        maxInputTokens: deps.maxSynthesisInputTokens,
      });
      const inputTokens = synthesis.telemetry?.inputTokens ?? 0;
      const outputTokens = synthesis.telemetry?.outputTokens ?? 0;
      return {
        synthesis,
        synthesisTokenCount: inputTokens + outputTokens,
      };
    } catch (err) {
      return {
        errors: [
          {
            stage: "synthesizeCurrentSessionConsolidation",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
        failureReason: "synthesis_failed",
      };
    }
  }

  // ---- Node: embedConsolidation --------------------------------------------

  async function embedConsolidationNode(
    state: StructMemConsolidationGraphState,
  ): Promise<Partial<StructMemConsolidationGraphState>> {
    if (!state.synthesis) return {};
    try {
      const embedding = await deps.embedFn(state.synthesis.summary_text);
      return { embedding };
    } catch (err) {
      return {
        errors: [
          {
            stage: "embedConsolidation",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
        failureReason: "embedding_failed",
      };
    }
  }

  // ---- Node: persistCurrentSessionConsolidation ----------------------------

  async function persistCurrentSessionConsolidationNode(
    state: StructMemConsolidationGraphState,
  ): Promise<Partial<StructMemConsolidationGraphState>> {
    if (
      !state.job ||
      !state.synthesis ||
      !state.embedding
    )
      return {};

    const consolidationId = uuidv4();
    const turnStart = state.turnStart ?? null;
    const turnEnd = state.turnEnd ?? null;

    const sourceRows = [
      ...(state.bufferEntries ?? []).map((entry: any) => ({
        entry: { id: entry.id, eventId: entry.eventId },
        sourceRole: "buffer" as const,
      })),
      ...(state.semanticSeedEntries ?? []).map((entry: any) => ({
        entry: { id: entry.id, eventId: entry.eventId },
        sourceRole: "semantic_seed" as const,
      })),
    ];

    try {
      const result = await deps.persistCurrentSessionFn({
        jobId: state.jobId,
        sessionId: state.job.sessionId,
        characterId: state.job.characterId,
        playerId: state.job.playerId,
        memoryNamespace: state.job.memoryNamespace,
        consolidationId,
        summaryText: state.synthesis.summary_text,
        summaryJson: state.synthesis.summary_json,
        embedding: state.embedding,
        turnStart,
        turnEnd,
        confidenceScore: state.synthesis.confidence_score,
        sourceRows,
      });

      return {
        currentConsolidationId: result.consolidationId,
        sourceEntryCount: result.sourceEntryCount,
        sourceLinkCount: result.sourceLinkCount,
      };
    } catch (err) {
      return {
        errors: [
          {
            stage: "persistCurrentSessionConsolidation",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
        failureReason: "db_write_failed",
      };
    }
  }

  // ---- Node: maybeWriteCrossSessionConsolidations --------------------------

  async function maybeWriteCrossSessionConsolidationsNode(
    state: StructMemConsolidationGraphState,
  ): Promise<Partial<StructMemConsolidationGraphState>> {
    if (
      !state.currentConsolidationId ||
      !state.synthesis
    )
      return {};
    try {
      const session = await deps.loadSessionFn(
        state.job?.sessionId ?? "",
      );
      if (!session) {
        return {
          crossSessionStatus: "skipped_no_session",
        };
      }
      const result = await deps.writeCrossSessionFn({
        session,
        currentConsolidationId: state.currentConsolidationId,
        currentSummaryText: state.synthesis.summary_text,
        currentSummaryJson: state.synthesis.summary_json,
        currentConfidenceScore: state.synthesis.confidence_score,
      });

      return {
        crossSessionStatus: result.status,
        crossSessionIds: result.crossSessionIds,
        continuityFamily: session.continuityFamily,
      };
    } catch (err) {
      return {
        errors: [
          {
            stage: "maybeWriteCrossSessionConsolidations",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
        failureReason: "cross_session_write_failed",
      };
    }
  }

  // ---- Node: markCompleteOrSkipped -----------------------------------------

  async function markCompleteOrSkippedNode(
    state: StructMemConsolidationGraphState,
  ): Promise<Partial<StructMemConsolidationGraphState>> {
    try {
      const status = state.finalStatus === "skipped" ? "skipped" : "completed";
      await deps.markJobFn(state.jobId, status);
      return { finalStatus: status };
    } catch (err) {
      return {
        errors: [
          {
            stage: "markCompleteOrSkipped",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
        failureReason: "db_write_failed",
      };
    }
  }

  // ---- Error sink + conditional routing ------------------------------------

  function errorSinkNode(): Partial<StructMemConsolidationGraphState> {
    return {};
  }

  function hasErrors(
    state: StructMemConsolidationGraphState,
  ): string {
    if (state.errors && state.errors.length > 0) return "__error__";
    return "__next__";
  }

  function afterSelectBuffer(
    state: StructMemConsolidationGraphState,
  ): string {
    if (state.finalStatus === "skipped") return "markCompleteOrSkipped";
    if (state.errors && state.errors.length > 0) return "__error__";
    return "synthesizeCurrentSessionConsolidation";
  }

  // ---- Graph construction --------------------------------------------------

  return new StateGraph(StructMemConsolidationGraphStateSchema)
    .addNode("loadClaimedConsolidationJob", loadClaimedConsolidationJobNode)
    .addNode("selectConsolidationBuffer", selectConsolidationBufferNode)
    .addNode(
      "synthesizeCurrentSessionConsolidation",
      synthesizeCurrentSessionConsolidationNode,
    )
    .addNode("embedConsolidation", embedConsolidationNode)
    .addNode(
      "persistCurrentSessionConsolidation",
      persistCurrentSessionConsolidationNode,
    )
    .addNode(
      "maybeWriteCrossSessionConsolidations",
      maybeWriteCrossSessionConsolidationsNode,
    )
    .addNode("markCompleteOrSkipped", markCompleteOrSkippedNode)
    .addNode("errorSink", errorSinkNode)
    .addConditionalEdges(START, hasErrors, {
      __error__: "errorSink",
      __next__: "loadClaimedConsolidationJob",
    })
    .addConditionalEdges("loadClaimedConsolidationJob", hasErrors, {
      __error__: "errorSink",
      __next__: "selectConsolidationBuffer",
    })
    .addConditionalEdges(
      "selectConsolidationBuffer",
      afterSelectBuffer,
      {
        markCompleteOrSkipped: "markCompleteOrSkipped",
        synthesizeCurrentSessionConsolidation:
          "synthesizeCurrentSessionConsolidation",
        __error__: "errorSink",
      },
    )
    .addConditionalEdges(
      "synthesizeCurrentSessionConsolidation",
      hasErrors,
      {
        __error__: "errorSink",
        __next__: "embedConsolidation",
      },
    )
    .addConditionalEdges("embedConsolidation", hasErrors, {
      __error__: "errorSink",
      __next__: "persistCurrentSessionConsolidation",
    })
    .addConditionalEdges(
      "persistCurrentSessionConsolidation",
      hasErrors,
      {
        __error__: "errorSink",
        __next__: "maybeWriteCrossSessionConsolidations",
      },
    )
    .addConditionalEdges(
      "maybeWriteCrossSessionConsolidations",
      hasErrors,
      {
        __error__: "errorSink",
        __next__: "markCompleteOrSkipped",
      },
    )
    .addEdge("markCompleteOrSkipped", END)
    .addEdge("errorSink", END)
    .compile({
      name: "orchestration.structmem_consolidation_graph",
    });
}

// ---- Lazy accessor ---------------------------------------------------------

let _graph: ReturnType<typeof createStructMemConsolidationGraph> | undefined;

export function getStructMemConsolidationGraph(): ReturnType<
  typeof createStructMemConsolidationGraph
> {
  if (!_graph) {
    _graph = createStructMemConsolidationGraph();
  }
  return _graph;
}

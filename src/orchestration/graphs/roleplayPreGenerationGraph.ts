import { StateGraph, START, END } from "@langchain/langgraph";
import {
  RoleplayGraphStateSchema,
  type RoleplayGraphState,
} from "../graphState/roleplayGraphState";
import type { RoleplayGraphDeps } from "./roleplayGraph";
import type { ChatSession } from "../../db/schema/chat";
import type { LoadRoleplayCharacterContextOutput } from "../roleplay/roleplayAdapters";
import type { ResolvedContext } from "../context/resolveContext";
import type { PromptContext } from "../prompt/buildPromptContext";
import { readRerankVariant } from "../../eval/experimentVariants";

export type { RoleplayGraphDeps };

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface PreGenerationResult {
  session?: ChatSession;
  characterContext?: LoadRoleplayCharacterContextOutput;
  resolvedContext?: ResolvedContext;
  promptContext?: PromptContext;
  errors: Array<{ stage: string; message: string }> | undefined;
}

// ---------------------------------------------------------------------------
// Graph factory
// ---------------------------------------------------------------------------

export function createRoleplayPreGenerationGraph(
  deps: RoleplayGraphDeps,
) {
  // ---- nodes ---------------------------------------------------------------

  async function loadSessionNode(state: RoleplayGraphState): Promise<Partial<RoleplayGraphState>> {
    try {
      return { session: await deps.loadSession(state.sessionId) };
    } catch (err) {
      console.error("[roleplayPreGenerationGraph/loadSession] error:", err);
      return { errors: [{ stage: "loadSession", message: err instanceof Error ? err.message : String(err) }] };
    }
  }

  async function loadCharacterContextNode(state: RoleplayGraphState): Promise<Partial<RoleplayGraphState>> {
    if (!state.session) return {};
    try {
      return { characterContext: await deps.loadCharacterContext({ session: state.session }) };
    } catch (err) {
      console.error("[roleplayPreGenerationGraph/loadCharacterContext] error:", err);
      return { errors: [{ stage: "loadCharacterContext", message: err instanceof Error ? err.message : String(err) }] };
    }
  }

  async function buildPreRerankContextNode(state: RoleplayGraphState): Promise<Partial<RoleplayGraphState>> {
    if (!state.session || !state.characterContext) return {};
    const fn = deps.buildPreRerankContext;
    if (!fn) return {};
    try {
      return { preRerankContext: await fn({ session: state.session!, userMessage: state.userMessage, characterDefaults: state.characterContext!.characterDefaults }) };
    } catch (err) {
      console.error("[roleplayPreGenerationGraph/buildPreRerankContext] error:", err);
      return { errors: [{ stage: "buildPreRerankContext", message: err instanceof Error ? err.message : String(err) }] };
    }
  }

  async function rerankNode(state: RoleplayGraphState): Promise<Partial<RoleplayGraphState>> {
    if (!state.preRerankContext) return {};
    const fn = deps.runLlmRerankFn;
    if (!fn) return {};
    try {
      const pre = state.preRerankContext as any;
      const result = await fn({
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
      });

      if (result.ok) {
        // LLM rerank succeeded - store the full result
        const rerankResult = {
          selectedContext: result.selectedContext,
          rerankOutput: result.rerankOutput,
          rerankFallbackUsed: false,
          rerankFallbackReason: null,
          rerankMs: result.rerankMs,
          selectorFallbackMs: undefined,
          canonChunks: result.canonChunks,
          canonScenes: result.canonScenes,
          filteredSessionSummary: result.filteredSessionSummary,
          filteredLatestTurnDelta: result.filteredLatestTurnDelta,
          filteredMemoryCorrections: result.filteredMemoryCorrections,
        };
        return { rerankResult };
      } else {
        // LLM rerank failed - store failure info for deterministicContextSelector
        return {
          rerankResult: null as any,
          rerankLlmError: {
            fallbackReason: result.fallbackReason,
            rerankMs: result.rerankMs,
          } as any,
        };
      }
    } catch (err) {
      console.error("[roleplayPreGenerationGraph/rerank] error:", err);
      return { errors: [{ stage: "rerank", message: err instanceof Error ? err.message : String(err) }] };
    }
  }

  async function assembleResolvedContextNode(state: RoleplayGraphState): Promise<Partial<RoleplayGraphState>> {
    if (!state.preRerankContext || !state.rerankResult) return {};
    const fn = deps.assembleResolvedContext;
    if (!fn) return {};
    try {
      return { resolvedContext: await fn(state.preRerankContext as any, state.rerankResult as any) };
    } catch (err) {
      console.error("[roleplayPreGenerationGraph/assembleResolvedContext] error:", err);
      return { errors: [{ stage: "assembleResolvedContext", message: err instanceof Error ? err.message : String(err) }] };
    }
  }

  async function buildPromptNode(state: RoleplayGraphState): Promise<Partial<RoleplayGraphState>> {
    if (!state.characterContext || !state.session || !state.resolvedContext) return {};
    try {
      return { promptContext: await deps.buildPromptContext({ characterDefaults: state.characterContext.characterDefaults, personaOverlay: state.characterContext.personaOverlay, session: state.session, resolvedContext: state.resolvedContext, userMessage: state.userMessage }) };
    } catch (err) {
      console.error("[roleplayPreGenerationGraph/buildPrompt] error:", err);
      return { errors: [{ stage: "buildPrompt", message: err instanceof Error ? err.message : String(err) }] };
    }
  }

  // ---- conditional routing -------------------------------------------------

  function hasErrors(state: RoleplayGraphState): string {
    if (state.errors && state.errors.length > 0) return "__error__";
    return "__next__";
  }

  // ---- variant-aware rerank routing ----------------------------------------

  /**
   * Choose which rerank node to route to based on RERANK_VARIANT.
   */
  function chooseRerankVariant(_state: RoleplayGraphState): string {
    const variant = readRerankVariant();
    if (variant === "deterministic_only") return "deterministicContextSelector";
    if (variant === "hybrid_score") return "hybridScoreRerank";
    // llm_rerank_v1 and llm_rerank_smaller_model both go through the LLM rerank node
    return "rerank";
  }

  const rerankVariantRouteMap = {
    rerank: "rerank" as const,
    deterministicContextSelector: "deterministicContextSelector" as const,
    hybridScoreRerank: "hybridScoreRerank" as const,
    __error__: "errorSink" as const,
  };

  function afterRerank(state: RoleplayGraphState): string {
    if (state.errors?.length) return "__error__";
    // runLlmRerank succeeded -> ok: true (rerankResult is set)
    if (state.rerankResult) return "assembleResolvedContext";
    // runLlmRerank failed -> rerankLlmError is set
    return "deterministicContextSelector";
  }

  const rerankRouteMap = {
    assembleResolvedContext: "assembleResolvedContext" as const,
    deterministicContextSelector: "deterministicContextSelector" as const,
    __error__: "errorSink" as const,
  };

  async function deterministicContextSelectorNode(state: RoleplayGraphState): Promise<Partial<RoleplayGraphState>> {
    if (!state.preRerankContext) return {};
    const pre = state.preRerankContext as any;
    const fn = deps.deterministicSelectorFn;
    if (!fn) return {};

    // Preserve the original rerank failure diagnostics from the rerank node
    // When deterministic_only is chosen as variant, there is no prior LLM error
    const llmError = state.rerankLlmError as { fallbackReason: string; rerankMs: number } | undefined;

    try {
      const { selectedContext, selectorFallbackMs } = await fn({
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
      });

      return {
        rerankResult: {
          selectedContext,
          rerankOutput: null,
          rerankFallbackUsed: true,
          rerankFallbackReason: llmError?.fallbackReason ?? "variant_deterministic_only",
          rerankMs: llmError?.rerankMs ?? 0,
          selectorFallbackMs,
          canonChunks: pre.canonChunks,
          canonScenes: pre.canonScenes,
          filteredSessionSummary: pre.sessionSummary,
          filteredLatestTurnDelta: pre.latestTurnDelta,
          filteredMemoryCorrections: pre.memoryCorrections,
        },
      };
    } catch (err) {
      console.error("[roleplayPreGenerationGraph/deterministicContextSelector] error:", err);
      return { errors: [{ stage: "deterministicContextSelector", message: err instanceof Error ? err.message : String(err) }] };
    }
  }

  // ---- hybrid score rerank node --------------------------------------------

  async function hybridScoreRerankNode(state: RoleplayGraphState): Promise<Partial<RoleplayGraphState>> {
    if (!state.preRerankContext) return {};
    const fn = deps.hybridScoreRerankFn;
    if (!fn) return {};
    try {
      const pre = state.preRerankContext as any;
      const result = await fn({
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
      });

      return {
        rerankResult: {
          selectedContext: result.selectedContext,
          rerankOutput: result.rerankOutput,
          rerankFallbackUsed: false,
          rerankFallbackReason: null,
          rerankMs: result.hybridMs,
          selectorFallbackMs: undefined,
          canonChunks: result.canonChunks,
          canonScenes: result.canonScenes,
          filteredSessionSummary: result.filteredSessionSummary,
          filteredLatestTurnDelta: result.filteredLatestTurnDelta,
          filteredMemoryCorrections: result.filteredMemoryCorrections,
        },
      };
    } catch (err) {
      console.error("[roleplayPreGenerationGraph/hybridScoreRerank] error:", err);
      return { errors: [{ stage: "hybridScoreRerank", message: err instanceof Error ? err.message : String(err) }] };
    }
  }

  // ---- error sink ----------------------------------------------------------

  function errorSinkNode(): Partial<RoleplayGraphState> {
    return {};
  }

  // ---- graph construction --------------------------------------------------

  return new StateGraph(RoleplayGraphStateSchema)
    .addNode("loadSession", loadSessionNode)
    .addNode("loadCharacterContext", loadCharacterContextNode)
    .addNode("buildPreRerankContext", buildPreRerankContextNode)
    .addNode("rerank", rerankNode)
    .addNode("deterministicContextSelector", deterministicContextSelectorNode)
    .addNode("hybridScoreRerank", hybridScoreRerankNode)
    .addNode("assembleResolvedContext", assembleResolvedContextNode)
    .addNode("buildPrompt", buildPromptNode)
    .addNode("errorSink", errorSinkNode)
    .addConditionalEdges(START, hasErrors, { __error__: END, __next__: "loadSession" })
    .addConditionalEdges("loadSession", hasErrors, { __error__: END, __next__: "loadCharacterContext" })
    .addConditionalEdges("loadCharacterContext", hasErrors, { __error__: END, __next__: "buildPreRerankContext" })
    .addConditionalEdges("buildPreRerankContext", chooseRerankVariant, rerankVariantRouteMap)
    .addConditionalEdges("rerank", afterRerank, rerankRouteMap)
    .addConditionalEdges("deterministicContextSelector", hasErrors, { __error__: END, __next__: "assembleResolvedContext" })
    .addConditionalEdges("hybridScoreRerank", hasErrors, { __error__: END, __next__: "assembleResolvedContext" })
    .addConditionalEdges("assembleResolvedContext", hasErrors, { __error__: END, __next__: "buildPrompt" })
    .addEdge("buildPrompt", END)
    .addEdge("errorSink", END)
    .compile({ name: "orchestration.roleplay_pre_generation_graph" });
}

export async function runRoleplayPreGenerationGraph(
  input: { sessionId: string; userMessage: string },
  deps: RoleplayGraphDeps,
): Promise<PreGenerationResult> {
  const graph = createRoleplayPreGenerationGraph(deps);
  const state = await graph.invoke(input);
  return {
    session: state.session,
    characterContext: state.characterContext,
    resolvedContext: state.resolvedContext,
    promptContext: state.promptContext,
    errors: state.errors,
  };
}

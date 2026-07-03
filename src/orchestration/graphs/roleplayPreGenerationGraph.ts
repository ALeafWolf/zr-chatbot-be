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
import type { ResponseDirectorInput } from "../director/runResponseDirector";
import { formatDirectorCharacterDigest } from "../../character/psychology/formatInternalLogic";
import { env } from "../../config/env";

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

  // TG2: Response director — produces [DIRECTOR NOTE] block, fail-open
  async function responseDirectorNode(state: RoleplayGraphState): Promise<Partial<RoleplayGraphState>> {
    if (!state.promptContext || !state.resolvedContext) return {};
    if (!deps.runResponseDirectorFn || !env.RESPONSE_DIRECTOR_ENABLED) return {};

    try {
      // Build distilled input from available state (fail-open on missing data)
      const promptCtx = state.promptContext;
      const resolved = state.resolvedContext;
      const characterCtx = state.characterContext;

      // F1a: segments come from resolvedContext.queryRewrite (not promptContext, which
      // has no queryRewrite field). Fall back to raw message on parse failure per design.
      const queryRewrite = resolved.queryRewrite;
      const segments = queryRewrite?.segments ?? [];

      // F1a: reply directions come from promptContext (populated by TG1 extraction).
      const replyDirections = promptCtx.replyDirections ?? [];

      const recentTurnPreviews = (promptCtx.conversationHistory ?? [])
        .slice(-4)
        .map((m) => {
          const preview = m.content.slice(0, 300);
          return `${m.role}: ${preview}`;
        });

      // F1b: emotional director fields from promptContext (populated by buildPromptContext).
      const bandLine = promptCtx.emotionalBandLine ?? "";
      const renderRuleTexts = promptCtx.emotionalRenderRuleTexts ?? [];
      const lastTraceEvent = promptCtx.emotionalLastTraceEvent;

      // F1b: open thread titles from resolvedContext.openThreads.
      const openThreadTitles = (resolved.openThreads ?? []).map((t) => t.text);

      // F1b: latest turn delta facts from resolvedContext.latestTurnDelta.
      const latestTurnDeltaFacts = resolved.latestTurnDelta?.facts ?? [];

      const directorInput: ResponseDirectorInput = {
        segments,
        replyDirections,
        bandLine,
        renderRuleTexts,
        lastTraceEvent,
        derivedState: {
          inferredMood: resolved.derivedState?.inferredMood ?? "unknown",
          inferredActivity: resolved.derivedState?.inferredActivity ?? "unknown",
          conversationalStance: resolved.derivedState?.conversationalStance ?? "unknown",
        },
        openThreadTitles,
        latestTurnDeltaFacts,
        canonTruthMode: promptCtx.canonTruthMode ?? "open_roleplay",
        selectedSourceSummaries: (promptCtx.selectedMemorySources ?? []).map(
          (s: { source: string; usageInstruction: string }) => `${s.source} (${s.usageInstruction})`,
        ),
        relationshipStatus: characterCtx?.personaOverlay?.relationship_status ?? "unknown",
        recentTurnPreviews,
        // TG5: Character digest from internal_logic subset
        characterDigest: characterCtx?.characterDefaults
          ? formatDirectorCharacterDigest(characterCtx.characterDefaults)
          : "",
        // TG5: Continuity scope for stage-gating awareness
        continuityScope:
          state.session?.continuityScope
          ?? characterCtx?.personaOverlay?.continuity_scope
          ?? "",
      };

      const result = await deps.runResponseDirectorFn(directorInput, { signal: state._signal });

      if (!result) return {};

      const { note, output } = result;
      let systemPrompt = promptCtx.systemPrompt;
      const slimmedBlocks: string[] = [];

      // TG6: Director-gated prompt slimming — apply BEFORE appending the note.
      // Each step is individually no-op-safe: missing string, no match, unfired
      // field, or absent flag ⇒ that unit is left untouched.
      const slimEnv = env.RESPONSE_DIRECTOR_SLIM_BLOCKS;
      const slimSet = new Set(
        slimEnv.split(",").map((t) => t.trim()).filter(Boolean),
      );

      // Validate tokens: warn + ignore unknown
      const knownTokens = new Set(["emotional_render", "format_resistance", "canon_correction"]);
      for (const token of slimSet) {
        if (!knownTokens.has(token)) {
          console.warn(`[responseDirector] unknown RESPONSE_DIRECTOR_SLIM_BLOCKS token: "${token}" — ignoring`);
        }
      }

      const slimmable = promptCtx.directorSlimmable;
      if (slimmable) {
        // 1. emotional_render: full block → band-line-only when mood_directive fired
        if (
          slimSet.has("emotional_render") &&
          output.mood_directive &&
          slimmable.emotionalRenderBlock &&
          slimmable.emotionalBandLineBlock
        ) {
          const before = systemPrompt;
          systemPrompt = systemPrompt.replace(slimmable.emotionalRenderBlock, slimmable.emotionalBandLineBlock);
          if (systemPrompt !== before) {
            slimmedBlocks.push("emotional_render");
          } else {
            console.warn("[responseDirector] emotional_render: exact-substring match failed — prompt unchanged");
          }
        }

        // 2. format_resistance: remove subsection only when the field fired
        if (
          slimSet.has("format_resistance") &&
          output.format_resistance &&
          slimmable.formatResistanceSubsection
        ) {
          const sub = slimmable.formatResistanceSubsection;
          // Try "sub + \n\n" (mid-body), then "\n\n + sub" (last part of body)
          let before = systemPrompt;
          systemPrompt = systemPrompt.replace(sub + "\n\n", "");
          if (systemPrompt !== before) {
            slimmedBlocks.push("format_resistance");
          } else {
            before = systemPrompt;
            systemPrompt = systemPrompt.replace("\n\n" + sub, "");
            if (systemPrompt !== before) {
              slimmedBlocks.push("format_resistance");
            } else {
              console.warn("[responseDirector] format_resistance: exact-substring match failed — prompt unchanged");
            }
          }
        }

        // 3. canon_correction: remove subsection only when the field fired
        if (
          slimSet.has("canon_correction") &&
          output.fact_correction &&
          slimmable.canonCorrectionSubsection
        ) {
          const sub = slimmable.canonCorrectionSubsection;
          let before = systemPrompt;
          systemPrompt = systemPrompt.replace(sub + "\n\n", "");
          if (systemPrompt !== before) {
            slimmedBlocks.push("canon_correction");
          } else {
            before = systemPrompt;
            systemPrompt = systemPrompt.replace("\n\n" + sub, "");
            if (systemPrompt !== before) {
              slimmedBlocks.push("canon_correction");
            } else {
              console.warn("[responseDirector] canon_correction: exact-substring match failed — prompt unchanged");
            }
          }
        }
      }

      // Append the [DIRECTOR NOTE] block as the last block of the system prompt
      const updatedCtx = { ...promptCtx, systemPrompt, directorSlimmedBlocks: slimmedBlocks.length > 0 ? slimmedBlocks : undefined };
      updatedCtx.systemPrompt = systemPrompt + "\n\n[DIRECTOR NOTE]\n" + note;

      if (slimmedBlocks.length > 0) {
        console.info(`[responseDirector] slimmed blocks: ${slimmedBlocks.join(", ")}`);
      }

      return { promptContext: updatedCtx };
    } catch (err) {
      console.warn("[roleplayPreGenerationGraph/responseDirector] error:", err);
      return {};
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
    .addNode("responseDirector", responseDirectorNode)
    .addNode("errorSink", errorSinkNode)
    .addConditionalEdges(START, hasErrors, { __error__: END, __next__: "loadSession" })
    .addConditionalEdges("loadSession", hasErrors, { __error__: END, __next__: "loadCharacterContext" })
    .addConditionalEdges("loadCharacterContext", hasErrors, { __error__: END, __next__: "buildPreRerankContext" })
    .addConditionalEdges("buildPreRerankContext", chooseRerankVariant, rerankVariantRouteMap)
    .addConditionalEdges("rerank", afterRerank, rerankRouteMap)
    .addConditionalEdges("deterministicContextSelector", hasErrors, { __error__: END, __next__: "assembleResolvedContext" })
    .addConditionalEdges("hybridScoreRerank", hasErrors, { __error__: END, __next__: "assembleResolvedContext" })
    .addConditionalEdges("assembleResolvedContext", hasErrors, { __error__: END, __next__: "buildPrompt" })
    .addConditionalEdges("buildPrompt", hasErrors, { __error__: END, __next__: "responseDirector" })
    .addEdge("responseDirector", END)
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

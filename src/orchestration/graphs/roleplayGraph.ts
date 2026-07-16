import { StateGraph, START, END } from "@langchain/langgraph";
import type { ChatSession } from "../../db/schema/chat";
import type { ModelBinding } from "../../config/models";
import { models } from "../../config/models";
import { loadSessionImpl } from "./routeGraphDeps";
import {
  loadRoleplayCharacterContext,
  resolveRoleplayContext,
  buildRoleplayPromptContext,
  type LoadRoleplayCharacterContextInput,
  type LoadRoleplayCharacterContextOutput,
  type ResolveRoleplayContextInput,
  type BuildRoleplayPromptContextInput,
} from "../roleplay/roleplayAdapters";
import {
  runRoleplayGenerationAdapter,
  type RoleplayGenerationEvent,
  type RoleplayGenerationInput,
} from "../roleplay/roleplayGenerationAdapter";
import {
  persistRoleplayTurn,
  type PersistRoleplayTurnInput,
  type PersistRoleplayTurnOutput,
} from "../roleplay/roleplayPersistenceAdapter";
import {
  persistCompletedTurn,
} from "../persistence/turnPersistence";
import { estimateModelCost } from "../../observability/traceMetadata";
import { postTurnRunner } from "../../jobs/postTurnRunner";
import {
  RoleplayGraphStateSchema,
  type RoleplayGraphState,
} from "../graphState/roleplayGraphState";
import { buildPreRerankContext, assembleResolvedContext } from "../context/resolveContext";
import { rerankContext as rerankContextFn } from "../context/rerankContext";
import {
  buildValidatorContext,
  generateDraft,
  validateDraft,
  rewriteDraft,
  safeDeflection,
  __testing as genTesting,
  type GenerateAndValidateResult,
} from "../generation/generateAndValidate";
import { filterDrafterFacingIssues } from "../generation/validationFlowHelpers";
import { runDeterministicSelector, runLlmRerank } from "../context/rerankContext";
import { runHybridScoreRerank } from "../context/hybridScoreRerank";
import { runResponseDirector } from "../director/runResponseDirector";

// ---------------------------------------------------------------------------
// Dependency injection shape
// ---------------------------------------------------------------------------

export interface RoleplayGraphDeps {
  loadSession: (sessionId: string) => Promise<ChatSession>;
  loadCharacterContext: (
    input: LoadRoleplayCharacterContextInput,
  ) => Promise<LoadRoleplayCharacterContextOutput>;
  resolveContext: (
    input: ResolveRoleplayContextInput,
  ) => Promise<any>;
  buildPromptContext: (
    input: BuildRoleplayPromptContextInput,
  ) => Promise<any>;
  runGeneration: (
    input: RoleplayGenerationInput,
  ) => AsyncGenerator<RoleplayGenerationEvent>;
  persistTurn: (
    input: PersistRoleplayTurnInput,
  ) => Promise<PersistRoleplayTurnOutput>;
  generationModelBinding: ModelBinding;
  buildPreRerankContext?: typeof buildPreRerankContext;
  assembleResolvedContext?: typeof assembleResolvedContext;
  rerankContextFn?: typeof rerankContextFn;
  /** LLM-only rerank seam (pre-generation graph). On success stores result; on failure routes to deterministicContextSelector. */
  runLlmRerankFn?: typeof runLlmRerank;
  deterministicSelectorFn?: typeof runDeterministicSelector;
  /** Hybrid score rerank seam (pre-generation graph variant path). */
  hybridScoreRerankFn?: typeof runHybridScoreRerank;
  generateDraftFn?: typeof generateDraft;
  validateDraftFn?: typeof validateDraft;
  rewriteDraftFn?: typeof rewriteDraft;
  safeDeflectionFn?: typeof safeDeflection;
  /** TG2: Response director stage — produces a [DIRECTOR NOTE] block appended to the system prompt. */
  runResponseDirectorFn?: typeof import("../director/runResponseDirector").runResponseDirector;
}

// ---------------------------------------------------------------------------
// Default production dependencies
// ---------------------------------------------------------------------------

async function* defaultRunGeneration(
  input: RoleplayGenerationInput,
): AsyncGenerator<RoleplayGenerationEvent> {
  yield* runRoleplayGenerationAdapter(input);
}

export const defaultRoleplayGraphDeps: RoleplayGraphDeps = {
  loadSession: loadSessionImpl,
  loadCharacterContext: loadRoleplayCharacterContext,
  resolveContext: resolveRoleplayContext,
  buildPromptContext: buildRoleplayPromptContext,
  runGeneration: defaultRunGeneration,
  persistTurn: async (input) => {
    return persistRoleplayTurn(input, {
      estimateModelCost,
      persistCompletedTurn,
      wakePostTurnRunner: () => postTurnRunner.wake(),
    });
  },
  generationModelBinding: models.generation,
  buildPreRerankContext,
  assembleResolvedContext,
  rerankContextFn,
  runLlmRerankFn: runLlmRerank,
  deterministicSelectorFn: runDeterministicSelector,
  hybridScoreRerankFn: runHybridScoreRerank,
  generateDraftFn: generateDraft,
  validateDraftFn: validateDraft,
  rewriteDraftFn: rewriteDraft,
  safeDeflectionFn: safeDeflection,
  runResponseDirectorFn: runResponseDirector,
};

// ---------------------------------------------------------------------------
// Roleplay graph factory
// ---------------------------------------------------------------------------

/**
 * Create a coarse roleplay graph that includes generation, validation,
 * deflection, persistence, and wake-post-turn nodes.
 *
 * ⚠️ DEV/SMOKE-ONLY — NOT the production stream path.
 *
 * This graph is useful for development and smoke testing, but it is NOT
 * behavior-equivalent to the production stream path (direct generation or
 * graph stream adapter). The production graph stream adapter uses the
 * pre-generation graph (see `runRoleplayPreGenerationGraph`) and delegates
 * generation/persistence to the existing stream adapters.
 *
 * Known gaps vs the production stream path:
 * - Fresh thought caches/arrays (`_cache`, `_thoughtsAcc`) instead of shared
 *   per-request instances.
 * - Hardcoded `isFirstUserTurn: false` — does not detect first-turn metadata.
 * - Persistence uses `thoughts: []` — recall thoughts are not accumulated.
 * - Drained generation via `runGeneration()` without stream event semantics.
 * - Validation context now uses the shared `buildValidatorContext()` helper
 *   (fixed in Task Group 2), which closes the original parity gap.
 *
 * Production graph stream routing (`createRoleplayStreamFn` in
 * `runCharacterTurn.ts`) does NOT use this function. It routes through
 * `runRoleplayPreGenerationGraph` + optional `createGenerationSubgraph`.
 */
export function createRoleplayGraph(
  deps: RoleplayGraphDeps = defaultRoleplayGraphDeps,
): ReturnType<typeof createRoleplayGraphImpl> {
  const graph = createRoleplayGraphImpl(deps);
  return graph;
}

/** Runtime marker: this function is dev/smoke-only, not the production stream path. */
(createRoleplayGraph as any).__devSmokeOnly = true;

/** @internal */
function createRoleplayGraphImpl(
  deps: RoleplayGraphDeps = defaultRoleplayGraphDeps,
) {
  // ---- nodes ---------------------------------------------------------------

  async function loadSessionNode(
    state: RoleplayGraphState,
  ): Promise<Partial<RoleplayGraphState>> {
    try {
      const session = await deps.loadSession(state.sessionId);
      return { session };
    } catch (err) {
      console.error("[roleplayGraph/loadSession] error:", err);
      return {
        errors: [{ stage: "loadSession", message: err instanceof Error ? err.message : String(err) }],
      };
    }
  }

  async function loadCharacterContextNode(
    state: RoleplayGraphState,
  ): Promise<Partial<RoleplayGraphState>> {
    if (!state.session) return {};
    try {
      const characterContext = await deps.loadCharacterContext({ session: state.session });
      return { characterContext };
    } catch (err) {
      console.error("[roleplayGraph/loadCharacterContext] error:", err);
      return {
        errors: [{ stage: "loadCharacterContext", message: err instanceof Error ? err.message : String(err) }],
      };
    }
  }

  async function resolveContextNode(
    state: RoleplayGraphState,
  ): Promise<Partial<RoleplayGraphState>> {
    if (!state.session || !state.characterContext) return {};
    try {
      const resolvedContext = await deps.resolveContext({
        session: state.session,
        userMessage: state.userMessage,
        characterDefaults: state.characterContext.characterDefaults,
      });
      return { resolvedContext };
    } catch (err) {
      console.error("[roleplayGraph/resolveContext] error:", err);
      return {
        errors: [{ stage: "resolveContext", message: err instanceof Error ? err.message : String(err) }],
      };
    }
  }

  async function buildPromptNode(
    state: RoleplayGraphState,
  ): Promise<Partial<RoleplayGraphState>> {
    if (!state.characterContext || !state.session || !state.resolvedContext) return {};
    try {
      const promptContext = await deps.buildPromptContext({
        characterDefaults: state.characterContext.characterDefaults,
        personaOverlay: state.characterContext.personaOverlay,
        session: state.session,
        resolvedContext: state.resolvedContext,
        userMessage: state.userMessage,
      });
      return { promptContext };
    } catch (err) {
      console.error("[roleplayGraph/buildPrompt] error:", err);
      return {
        errors: [{ stage: "buildPrompt", message: err instanceof Error ? err.message : String(err) }],
      };
    }
  }

  // ---- generation nodes -----------------------------------------------------

  async function generateDraftNode(
    state: RoleplayGraphState,
  ): Promise<Partial<RoleplayGraphState>> {
    if (!state.promptContext || !state.session || !state.characterContext) return {};
    const fn = deps.generateDraftFn;
    if (!fn) return {};

    try {
      // Guards at the top of this function ensure these are non-null
      const session = state.session!;
      const characterContext = state.characterContext!;
      const promptContext = state.promptContext!;

      const gen = fn({
        promptContext,
        userMessage: state.userMessage,
        session,
        characterDefaults: characterContext.characterDefaults,
        toolCtx: {
          sessionId: session.sessionId,
          characterId: session.characterId,
          memoryNamespace: session.memoryNamespace,
          continuityScope: session.continuityScope,
          continuityFamily: session.continuityFamily as "main_world" | "au",
          signal: new AbortController().signal,
        },
        thoughtSummaryCache: new Map(),
        thoughtsAcc: [],
        isFirstUserTurn: false,
        voiceHints: characterContext.voiceHints ?? "",
        openAICompatibleRequestExtensions: undefined,
        buildMessages: genTesting.buildToolMessages,
      });
      // Drain the generator using the iterator protocol to capture the return value
      const iterator = gen[Symbol.asyncIterator]();
      let next = await iterator.next();
      while (!next.done) {
        next = await iterator.next();
      }
      const draft = next.value as { content: string; inputTokens: number; outputTokens: number } | undefined;
      if (draft) return { draft };
      return {};
    } catch (err) {
      console.error("[roleplayGraph/generateDraft] error:", err);
      const toolLoopExceeded = err != null && typeof err === "object" && "name" in err && (err as Error).name === "ToolLoopExceededError";
      return {
        errors: [{ stage: "generateDraft", message: err instanceof Error ? err.message : String(err), ...(toolLoopExceeded ? { toolLoopExceeded: true } : {}) }],
      };
    }
  }

  async function validateDraftNode(
    state: RoleplayGraphState,
  ): Promise<Partial<RoleplayGraphState>> {
    const fn = deps.validateDraftFn;
    if (!fn) return {};

    const draftContent = (state.rewriteDraft as any)?.content ?? (state.draft as any)?.content;
    if (!draftContent) return {};

    try {
      const attempt = state.rewriteDraft ? 2 : 1;

      const validatorContext = buildValidatorContext({
        session: {
          characterId: state.session?.characterId ?? "",
          continuityScope: state.session?.continuityScope ?? "main",
          mode: state.session?.mode ?? "canonical_live",
        },
        personaOverlay: {
          max_nsfw_level: state.characterContext?.personaOverlay?.max_nsfw_level ?? "none",
          escalation_rule: state.characterContext?.personaOverlay?.escalation_rule ?? "",
          out_of_scope_chapter_behavior: state.characterContext?.personaOverlay?.out_of_scope_chapter_behavior ?? "",
        },
        promptContext: {
          conversationHistory: state.promptContext?.conversationHistory ?? [],
          retrievedCanonNarrative: state.promptContext?.retrievedCanonNarrative,
          selectedMemorySources: state.promptContext?.selectedMemorySources,
          canonTruthMode: state.promptContext?.canonTruthMode,
        },
        userMessage: state.userMessage,
        signal: (state as any)._signal,
      });

      const result = await fn(draftContent, validatorContext as any, attempt);
      if (attempt === 1) return { validation1Result: result };
      return { validation2Result: result };
    } catch (err) {
      console.error("[roleplayGraph/validateDraft] error:", err);
      return {
        errors: [{ stage: "validateDraft", message: err instanceof Error ? err.message : String(err) }],
      };
    }
  }

  async function rewriteDraftNode(
    state: RoleplayGraphState,
  ): Promise<Partial<RoleplayGraphState>> {
    if (!state.promptContext || !state.session || !state.characterContext || !state.validation1Result) return {};
    const fn = deps.rewriteDraftFn;
    if (!fn) return {};

    const session = state.session;
    const characterContext = state.characterContext;
    const promptContext = state.promptContext;

    const issues = filterDrafterFacingIssues((state.validation1Result as any).issues ?? []);
    const rewriteIntro = "Revising response...";

    try {
      const gen = fn({
        promptContext,
        userMessage: state.userMessage,
        session,
        characterDefaults: characterContext.characterDefaults,
        toolCtx: {
          sessionId: session.sessionId,
          characterId: session.characterId,
          memoryNamespace: session.memoryNamespace,
          continuityScope: session.continuityScope,
          continuityFamily: session.continuityFamily as "main_world" | "au",
          signal: new AbortController().signal,
        },
        thoughtSummaryCache: new Map(),
        thoughtsAcc: [],
        isFirstUserTurn: false,
        voiceHints: characterContext.voiceHints ?? "",
        openAICompatibleRequestExtensions: undefined,
        issues,
        rewriteIntro,
        buildRewriteMessages: genTesting.buildRewriteToolMessages,
      });
      const iterator = gen[Symbol.asyncIterator]();
      let next = await iterator.next();
      while (!next.done) {
        next = await iterator.next();
      }
      const rewriteDraft = next.value as { content: string; inputTokens: number; outputTokens: number } | undefined;
      if (rewriteDraft) return { rewriteDraft };
      return {};
    } catch (err) {
      console.error("[roleplayGraph/runRewriteDraft] error:", err);
      const toolLoopExceeded = err != null && typeof err === "object" && "name" in err && (err as Error).name === "ToolLoopExceededError";
      return {
        errors: [{ stage: "runRewriteDraft", message: err instanceof Error ? err.message : String(err), ...(toolLoopExceeded ? { toolLoopExceeded: true } : {}) }],
      };
    }
  }

  async function safeDeflectionNode(
    state: RoleplayGraphState,
  ): Promise<Partial<RoleplayGraphState>> {
    const fn = deps.safeDeflectionFn;
    if (!fn) return {};

    const characterContext = state.characterContext;
    const safeText = characterContext?.characterDefaults?.safe_deflection ?? "I am not sure.";

    // Detect the deflection reason from graph state context
    const hasDraftToolLoopErr = state.errors?.some((e) => (e as any).stage === "generateDraft" && (e as any).toolLoopExceeded);
    const hasRewriteToolLoopErr = state.errors?.some((e) => (e as any).stage === "runRewriteDraft" && (e as any).toolLoopExceeded);
    const reason: "tool_loop_exceeded" | "rewrite_tool_loop_exceeded" | "validator_hard_fail" =
      hasDraftToolLoopErr ? "tool_loop_exceeded" :
      hasRewriteToolLoopErr ? "rewrite_tool_loop_exceeded" :
      "validator_hard_fail";

    try {
      const gen = fn({
        characterName: characterContext?.characterDefaults?.name ?? "",
        safeDeflectionText: safeText,
        reason,
        thoughtSummaryCache: new Map(),
        thoughtsAcc: [],
        voiceHints: characterContext?.voiceHints ?? "",
      });
      const iterator = gen[Symbol.asyncIterator]();
      let next = await iterator.next();
      while (!next.done) {
        next = await iterator.next();
      }
      const result = next.value as GenerateAndValidateResult | undefined;
      if (result) return { generationResult: result };
      return { generationResult: { content: safeText, validatorResult: { in_character: true, canon_consistent: true, session_state_consistent: true, nsfw_within_bounds: true, issues: [], needs_rewrite: false }, wasRewritten: false, wasDeflected: true, inputTokens: 0, outputTokens: 0 } as any };
    } catch (err) {
      console.error("[roleplayGraph/safeDeflection] error:", err);
      return {
        errors: [{ stage: "safeDeflection", message: err instanceof Error ? err.message : String(err) }],
      };
    }
  }

  async function buildGenerationResultNode(
    state: RoleplayGraphState,
  ): Promise<Partial<RoleplayGraphState>> {
    const draft = state.draft as { content: string; inputTokens: number; outputTokens: number } | undefined;
    const rewrite = state.rewriteDraft as { content: string; inputTokens: number; outputTokens: number } | undefined;
    let v1 = state.validation1Result as any;
    let v2 = state.validation2Result as any;

    if (!draft) return {};

    // Normalize meta-only validation failures: if validation says needs_rewrite
    // but filterDrafterFacingIssues returns empty, clear needs_rewrite and issues
    // to match generateAndValidateStream behavior.
    const normalizeMetaOnly = (v: any) => {
      if (!v || !v.needs_rewrite) return v;
      const drafterIssues = filterDrafterFacingIssues(v.issues ?? []);
      if (drafterIssues.length === 0) {
        return { ...v, needs_rewrite: false, issues: [] };
      }
      return v;
    };

    v1 = normalizeMetaOnly(v1);
    v2 = normalizeMetaOnly(v2);

    const finalDraft = rewrite ?? draft;
    const finalValidation = v2 ?? v1;
    const wasRewritten = !!rewrite;
    const inputTokens = (draft.inputTokens ?? 0) + (rewrite?.inputTokens ?? 0);
    const outputTokens = (draft.outputTokens ?? 0) + (rewrite?.outputTokens ?? 0);

    const generationResult: GenerateAndValidateResult = {
      content: finalDraft.content,
      validatorResult: finalValidation ?? {
        in_character: true,
        canon_consistent: true,
        session_state_consistent: true,
        nsfw_within_bounds: true,
        issues: [],
        needs_rewrite: false,
      },
      wasRewritten,
      wasDeflected: false,
      inputTokens,
      outputTokens,
    };

    return { generationResult };
  }

  // ---- existing node: persistTurn -------------------------------------------

  async function persistTurnNode(
    state: RoleplayGraphState,
  ): Promise<Partial<RoleplayGraphState>> {
    if (!state.session || !state.generationResult || !state.resolvedContext) return {};
    try {
      const { persistedRoute, persisted } = await deps.persistTurn({
        session: state.session,
        userMessage: state.userMessage,
        generationResult: state.generationResult,
        derivedState: state.resolvedContext.derivedState,
        memories: state.resolvedContext.memories ?? [],
        thoughts: [],
        generationModelBinding: deps.generationModelBinding,
        finalRecallTimedOut: false,
      });
      return { persistedRoute, persisted };
    } catch (err) {
      console.error("[roleplayGraph/persistTurn] error:", err);
      return {
        errors: [{ stage: "persistTurn", message: err instanceof Error ? err.message : String(err) }],
      };
    }
  }

  // ---- error sink ----------------------------------------------------------

  function errorSinkNode(): Partial<RoleplayGraphState> {
    return {};
  }

  // ---- conditional routing -------------------------------------------------

  function afterGenerateDraft(state: RoleplayGraphState): string {
    if (state.errors?.some((e) => (e as any).toolLoopExceeded)) return "safeDeflection";
    if (state.errors?.length) return "__error__";
    return "validateDraft";
  }

  function afterValidateDraft(state: RoleplayGraphState): string {
    if (state.errors?.length) return "__error__";
    const isSecondPass = !!state.validation2Result;
    const result = state.validation2Result ?? state.validation1Result;
    if (!result) return "__error__";
    const r = result as { needs_rewrite?: boolean; issues?: string[] };
    if (!r.needs_rewrite) return "buildGenerationResult";
    // Check for meta-only issues on both passes (matching generateAndValidateStream)
    const drafterIssues = filterDrafterFacingIssues(r.issues ?? []);
    if (drafterIssues.length === 0) return "buildGenerationResult";
    if (isSecondPass) return "safeDeflection";
    return "rewriteDraft";
  }

  function afterRewriteDraft(state: RoleplayGraphState): string {
    if (state.errors?.some((e) => (e as any).toolLoopExceeded)) return "safeDeflection";
    if (state.errors?.length) return "__error__";
    return "validateDraft";
  }

  const errorRouteMap = {
    persistTurn: "persistTurn" as const,
    __error__: "errorSink" as const,
  };

  function buildResultOrError(state: RoleplayGraphState): string {
    if (state.generationResult) {
      // When a result exists, treat toolLoopExceeded errors as handled
      // (safeDeflectionNode already produced a valid generationResult).
      // Only fail on non-toolLoop errors that indicate real failures.
      if (state.errors?.length) {
        const realErrors = state.errors.filter((e) => !(e as any).toolLoopExceeded);
        if (realErrors.length > 0) return "__error__";
      }
      return "persistTurn";
    }
    if (state.errors?.length) return "__error__";
    return "persistTurn";
  }

  const genRouteMap = {
    validateDraft: "validateDraft" as const,
    safeDeflection: "safeDeflection" as const,
    __error__: "errorSink" as const,
  };

  const validateRouteMap = {
    buildGenerationResult: "buildGenerationResult" as const,
    rewriteDraft: "runRewriteDraft" as const,
    safeDeflection: "safeDeflection" as const,
    __error__: "errorSink" as const,
  };

  const rewriteRouteMap = {
    validateDraft: "validateDraft" as const,
    safeDeflection: "safeDeflection" as const,
    __error__: "errorSink" as const,
  };

  // ---- graph construction --------------------------------------------------

  return new StateGraph(RoleplayGraphStateSchema)
    .addNode("loadSession", loadSessionNode)
    .addNode("loadCharacterContext", loadCharacterContextNode)
    .addNode("resolveContext", resolveContextNode)
    .addNode("buildPrompt", buildPromptNode)
    .addNode("generateDraft", generateDraftNode)
    .addNode("validateDraft", validateDraftNode)
    .addNode("runRewriteDraft", rewriteDraftNode)
    .addNode("safeDeflection", safeDeflectionNode)
    .addNode("buildGenerationResult", buildGenerationResultNode)
    .addNode("persistTurn", persistTurnNode)
    .addNode("errorSink", errorSinkNode)
    .addEdge(START, "loadSession")
    .addEdge("loadSession", "loadCharacterContext")
    .addEdge("loadCharacterContext", "resolveContext")
    .addEdge("resolveContext", "buildPrompt")
    .addEdge("buildPrompt", "generateDraft")
    .addConditionalEdges("generateDraft", afterGenerateDraft, genRouteMap)
    .addConditionalEdges("validateDraft", afterValidateDraft, validateRouteMap)
    .addConditionalEdges("runRewriteDraft", afterRewriteDraft, rewriteRouteMap)
    .addConditionalEdges("safeDeflection", buildResultOrError, errorRouteMap)
    .addConditionalEdges("buildGenerationResult", buildResultOrError, errorRouteMap)
    .addEdge("persistTurn", END)
    .addEdge("errorSink", END)
    .compile();
}

/** Default roleplay graph instance. Created lazily to avoid circular module initialization issues. */
let _roleplayGraph: ReturnType<typeof createRoleplayGraph> | undefined;
export function getRoleplayGraph(): ReturnType<typeof createRoleplayGraph> {
  if (!_roleplayGraph) _roleplayGraph = createRoleplayGraph();
  return _roleplayGraph;
}

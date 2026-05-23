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
  generateDraft,
  validateDraft,
  rewriteDraft,
  safeDeflection,
  __testing as genTesting,
  type GenerateAndValidateResult,
} from "../generation/generateAndValidate";
import { filterDrafterFacingIssues } from "../generation/validationFlowHelpers";
import { runDeterministicSelector, runLlmRerank } from "../context/rerankContext";

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
  generateDraftFn?: typeof generateDraft;
  validateDraftFn?: typeof validateDraft;
  rewriteDraftFn?: typeof rewriteDraft;
  safeDeflectionFn?: typeof safeDeflection;
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
  generateDraftFn: generateDraft,
  validateDraftFn: validateDraft,
  rewriteDraftFn: rewriteDraft,
  safeDeflectionFn: safeDeflection,
};

// ---------------------------------------------------------------------------
// Roleplay graph factory
// ---------------------------------------------------------------------------

export function createRoleplayGraph(
  deps: RoleplayGraphDeps = defaultRoleplayGraphDeps,
) {
  // ---- existing nodes -------------------------------------------------------

  async function loadSessionNode(
    state: RoleplayGraphState,
  ): Promise<Partial<RoleplayGraphState>> {
    try {
      const session = await deps.loadSession(state.sessionId);
      return { session };
    } catch (err) {
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
      const gen = fn({
        promptContext: state.promptContext as any,
        userMessage: state.userMessage,
        session: state.session as ChatSession,
        characterDefaults: (state.characterContext as any).characterDefaults,
        toolCtx: { sessionId: state.session.sessionId, characterId: state.session.characterId, memoryNamespace: state.session.memoryNamespace, continuityScope: state.session.continuityScope, continuityFamily: state.session.continuityFamily, signal: new AbortController().signal } as any,
        thoughtSummaryCache: new Map(),
        thoughtsAcc: [],
        isFirstUserTurn: false,
        voiceHints: (state.characterContext as any).voiceHints ?? "",
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
      const personaOverlay = (state.characterContext as any)?.personaOverlay ?? {};
      const validatorInput = {
        characterId: state.session?.characterId ?? "",
        continuityScope: state.session?.continuityScope ?? "main",
        mode: state.session?.mode ?? "canonical_live",
        maxNsfwLevel: personaOverlay.max_nsfw_level ?? "none",
        escalationRule: personaOverlay.escalation_rule ?? "",
        outOfScopeChapterBehavior: personaOverlay.out_of_scope_chapter_behavior ?? "",
        recentContext: "",
        retrievedCanonNarrative: "",
        wasCanonInjected: false,
        selectedMemorySources: [],
        signal: undefined,
      };
      const result = await fn(draftContent, validatorInput as any, attempt);
      if (attempt === 1) return { validation1Result: result };
      return { validation2Result: result };
    } catch (err) {
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

    const issues = filterDrafterFacingIssues((state.validation1Result as any).issues ?? []);
    const rewriteIntro = "Revising response...";

    try {
      const gen = fn({
        promptContext: state.promptContext as any,
        userMessage: state.userMessage,
        session: state.session as ChatSession,
        characterDefaults: (state.characterContext as any).characterDefaults,
        toolCtx: { sessionId: state.session.sessionId, characterId: state.session.characterId, memoryNamespace: state.session.memoryNamespace, continuityScope: state.session.continuityScope, continuityFamily: state.session.continuityFamily, signal: new AbortController().signal } as any,
        thoughtSummaryCache: new Map(),
        thoughtsAcc: [],
        isFirstUserTurn: false,
        voiceHints: (state.characterContext as any).voiceHints ?? "",
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

    const safeText = (state.characterContext as any)?.characterDefaults?.safe_deflection ?? "I am not sure.";

    // Detect the deflection reason from graph state context
    const hasDraftToolLoopErr = state.errors?.some((e) => (e as any).stage === "generateDraft" && (e as any).toolLoopExceeded);
    const hasRewriteToolLoopErr = state.errors?.some((e) => (e as any).stage === "runRewriteDraft" && (e as any).toolLoopExceeded);
    const reason: "tool_loop_exceeded" | "rewrite_tool_loop_exceeded" | "validator_hard_fail" =
      hasDraftToolLoopErr ? "tool_loop_exceeded" :
      hasRewriteToolLoopErr ? "rewrite_tool_loop_exceeded" :
      "validator_hard_fail";

    try {
      const gen = fn({
        characterName: (state.characterContext as any)?.characterDefaults?.name ?? "",
        safeDeflectionText: safeText,
        reason,
        thoughtSummaryCache: new Map(),
        thoughtsAcc: [],
        voiceHints: (state.characterContext as any)?.voiceHints ?? "",
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

  function hasErrors(state: RoleplayGraphState): string {
    if (state.errors && state.errors.length > 0) return "__error__";
    return "__next__";
  }

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

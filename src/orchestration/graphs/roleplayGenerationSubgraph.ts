import { StateGraph, START } from "@langchain/langgraph";
import { RoleplayGraphStateSchema, type RoleplayGraphState } from "../graphState/roleplayGraphState";
import type { RoleplayGraphDeps } from "./roleplayGraph";
import type { GenerateAndValidateResult } from "../generation/generateAndValidate";
import type { OrchestrationStreamEvent, Thought } from "../thought/thoughtTypes";
import { filterDrafterFacingIssues } from "../generation/validationFlowHelpers";
import { __testing as genTesting } from "../generation/generateAndValidate";

/**
 * Create a generation subgraph that runs generation/validation/rewrite/deflection
 * as graph nodes. Events are pushed to `sharedEvents` as they are produced so
 * the stream adapter can yield them in real time via polling.
 */
export function createGenerationSubgraph(deps: RoleplayGraphDeps) {
  // Shared event collector — all nodes drain async generators into this array.
  // The stream adapter polls it concurrently with graph execution to yield
  // events in real time instead of buffering until genGraph.invoke() completes.
  const sharedEvents: OrchestrationStreamEvent[] = [];

  // ---- Helper to drain an async generator and collect events ----------------

  async function drainGenerator(
    gen: AsyncGenerator<any, any, unknown>,
  ): Promise<any> {
    const iter = gen[Symbol.asyncIterator]();
    let n = await iter.next();
    while (!n.done) {
      const ev = n.value;
      if (ev && typeof ev === "object" && "type" in ev) {
        sharedEvents.push(ev as OrchestrationStreamEvent);
        // NOTE: generation helpers already push thoughts to thoughtsAcc.
        // Do NOT push again here to avoid duplicate thought accumulation.
      }
      n = await iter.next();
    }
    return n.value;
  }

  // ---- Nodes ---------------------------------------------------------------

  async function genDraft(state: RoleplayGraphState): Promise<Partial<RoleplayGraphState>> {
    if (!state.promptContext || !state.session || !state.characterContext) return {};
    const fn = deps.generateDraftFn;
    if (!fn) return {};
    const ctx = state as any;
    try {
      const gen = fn({
        promptContext: state.promptContext as any,
        userMessage: state.userMessage,
        session: state.session as any,
        characterDefaults: (state.characterContext as any).characterDefaults,
        toolCtx: {
          sessionId: (state.session as any).sessionId,
          characterId: (state.session as any).characterId,
          memoryNamespace: (state.session as any).memoryNamespace,
          continuityScope: (state.session as any).continuityScope,
          continuityFamily: (state.session as any).continuityFamily as "main_world" | "au",
          signal: ctx._signal ?? new AbortController().signal,
        } as any,
        thoughtSummaryCache: ctx._cache ?? new Map(),
        thoughtsAcc: ctx._thoughtsAcc ?? [],
        isFirstUserTurn: ctx._isFirstUserTurn ?? false,
        voiceHints: ctx._voiceHints ?? "",
        openAICompatibleRequestExtensions: undefined,
        buildMessages: genTesting.buildToolMessages,
      });
      const value = await drainGenerator(gen);
      if (value) {
        return { draft: value, generationEvents: sharedEvents };
      }
      return {};
    } catch (e: any) {
      return { errors: [{ stage: "generateDraft", message: e.message ?? String(e), toolLoopExceeded: e.name === "ToolLoopExceededError" }] as any };
    }
  }

  async function valDraft(state: RoleplayGraphState): Promise<Partial<RoleplayGraphState>> {
    const fn = deps.validateDraftFn; if (!fn) return {};
    const dc = (state.rewriteDraft as any)?.content ?? (state.draft as any)?.content; if (!dc) return {};
    try {
      const a = state.rewriteDraft ? 2 : 1; const po = (state.characterContext as any)?.personaOverlay ?? {};
      const r = await fn(dc, { characterId: (state.session as any)?.characterId ?? "", continuityScope: (state.session as any)?.continuityScope ?? "main", mode: (state.session as any)?.mode ?? "canonical_live", maxNsfwLevel: po.max_nsfw_level ?? "none", escalationRule: po.escalation_rule ?? "", outOfScopeChapterBehavior: po.out_of_scope_chapter_behavior ?? "", recentContext: "", retrievedCanonNarrative: "", wasCanonInjected: false, selectedMemorySources: [], signal: undefined } as any, a);
      return a === 1 ? { validation1Result: r } : { validation2Result: r };
    } catch (e: any) { return { errors: [{ stage: "validateDraft", message: String(e) }] as any }; }
  }

  async function rwDraft(state: RoleplayGraphState): Promise<Partial<RoleplayGraphState>> {
    if (!state.validation1Result) return {}; const fn = deps.rewriteDraftFn; if (!fn) return {};
    const issues = filterDrafterFacingIssues((state.validation1Result as any).issues ?? []);
    const ctx = state as any;
    try {
      const gen = fn({
        promptContext: state.promptContext as any, userMessage: state.userMessage, session: state.session as any,
        characterDefaults: (state.characterContext as any).characterDefaults,
        toolCtx: { sessionId: (state.session as any).sessionId, characterId: (state.session as any).characterId, memoryNamespace: (state.session as any).memoryNamespace, continuityScope: (state.session as any).continuityScope, continuityFamily: (state.session as any).continuityFamily as "main_world" | "au", signal: ctx._signal ?? new AbortController().signal } as any,
        thoughtSummaryCache: ctx._cache ?? new Map(), thoughtsAcc: ctx._thoughtsAcc ?? [], isFirstUserTurn: ctx._isFirstUserTurn ?? false,
        voiceHints: ctx._voiceHints ?? "", openAICompatibleRequestExtensions: undefined,
        issues, rewriteIntro: "Revising response...", buildRewriteMessages: genTesting.buildRewriteToolMessages,
      });
      const value = await drainGenerator(gen);
      if (value) return { rewriteDraft: value, generationEvents: sharedEvents };
      return {};
    } catch (e: any) { return { errors: [{ stage: "runRewriteDraft", message: String(e), toolLoopExceeded: e.name === "ToolLoopExceededError" }] as any }; }
  }

  async function safeDef(state: RoleplayGraphState): Promise<Partial<RoleplayGraphState>> {
    const fn = deps.safeDeflectionFn; if (!fn) return {};
    const st = (state.characterContext as any)?.characterDefaults?.safe_deflection ?? "";
    const ctx = state as any;
    const isD = state.errors?.some((e: any) => e.stage === "generateDraft" && e.toolLoopExceeded);
    const isR = state.errors?.some((e: any) => e.stage === "runRewriteDraft" && e.toolLoopExceeded);
    try {
      const gen = fn({ characterName: (state.characterContext as any)?.characterDefaults?.name ?? "", safeDeflectionText: st, reason: isD ? "tool_loop_exceeded" : isR ? "rewrite_tool_loop_exceeded" : "validator_hard_fail", thoughtSummaryCache: ctx._cache ?? new Map(), thoughtsAcc: ctx._thoughtsAcc ?? [], voiceHints: ctx._voiceHints ?? "" });
      const value = await drainGenerator(gen);
      return value ? { generationResult: value as GenerateAndValidateResult, generationEvents: sharedEvents } : {};
    } catch (e: any) { return { errors: [{ stage: "safeDeflection", message: e.message ?? String(e) }] as any }; }
  }

  /**
   * Terminal node for unhandled generation errors. Does not set
   * `generationResult`, so the stream adapter can detect the error state and
   * yield an SSE error event instead of persisting the turn.
   */
  async function errorSink(_state: RoleplayGraphState): Promise<Partial<RoleplayGraphState>> {
    return {};
  }

  async function buildRes(state: RoleplayGraphState): Promise<Partial<RoleplayGraphState>> {
    const d = state.draft as any; const rw = state.rewriteDraft as any; if (!d) return {};
    let v1 = state.validation1Result as any, v2 = state.validation2Result as any;
    const n = (v: any) => (!v?.needs_rewrite ? v : filterDrafterFacingIssues(v.issues ?? []).length === 0 ? { ...v, needs_rewrite: false, issues: [] } : v);
    v1 = n(v1); v2 = n(v2);
    return { generationResult: { content: (rw ?? d).content, validatorResult: (v2 ?? v1) ?? { in_character: true, canon_consistent: true, session_state_consistent: true, nsfw_within_bounds: true, issues: [], needs_rewrite: false }, wasRewritten: !!rw, wasDeflected: false, inputTokens: (d.inputTokens ?? 0) + (rw?.inputTokens ?? 0), outputTokens: (d.outputTokens ?? 0) + (rw?.outputTokens ?? 0) } };
  }

  // ---- Routing -------------------------------------------------------------

  /**
   * Main routing after `validateDraft` (attempt 1 or 2).
   *
   * Priority:
   * 1. Non-tool-loop generation/validation errors -> errorSink (fatal)
   * 2. Handled tool-loop errors -> safeDeflection
   * 3. Validation needs rewrite (with substantive issues) -> runRewriteDraft (first pass) / safeDeflection (second pass)
   * 4. No rewrite needed or meta-only issues -> buildGenerationResult
   */
  function route(state: RoleplayGraphState): string {
    // Non-handled errors (not tool-loop) are fatal — route to errorSink
    if (state.errors?.some((e: any) => e.stage === "generateDraft" && !e.toolLoopExceeded)) return "e";
    if (state.errors?.some((e: any) => e.stage === "validateDraft")) return "e";
    // Handled tool-loop errors route to safeDeflection
    if (state.errors?.some((e: any) => e.stage === "generateDraft" && e.toolLoopExceeded)) return "s";
    if (state.errors?.some((e: any) => e.stage === "runRewriteDraft" && e.toolLoopExceeded)) return "s";
    const v = (state.validation2Result ?? state.validation1Result) as any;
    if (v?.needs_rewrite && filterDrafterFacingIssues(v.issues ?? []).length > 0) return state.validation2Result ? "s" : "rw";
    return "b";
  }

  const MAP = { s: "safeDeflection" as const, rw: "runRewriteDraft" as const, b: "buildGenerationResult" as const, e: "errorSink" as const };
  const RW_MAP = { s: "safeDeflection" as const, b: "buildGenerationResult" as const, v: "validateDraft" as const, e: "errorSink" as const };

  const graph = new StateGraph(RoleplayGraphStateSchema)
    .addNode("generateDraft", genDraft).addNode("validateDraft", valDraft)
    .addNode("runRewriteDraft", rwDraft).addNode("safeDeflection", safeDef).addNode("buildGenerationResult", buildRes).addNode("errorSink", errorSink)
    .addEdge(START, "generateDraft")
    .addEdge("generateDraft", "validateDraft")
    .addConditionalEdges("validateDraft", route, MAP)
    .addConditionalEdges("runRewriteDraft", (s: RoleplayGraphState): string => {
      if (s.errors?.some((e: any) => e.stage === "runRewriteDraft" && !e.toolLoopExceeded)) return "e";
      if (s.errors?.some((e: any) => e.toolLoopExceeded)) return "s";
      return "v";
    }, RW_MAP)
    .compile({ name: "orchestration.roleplay_generation_graph" });

  return { graph, sharedEvents };
}

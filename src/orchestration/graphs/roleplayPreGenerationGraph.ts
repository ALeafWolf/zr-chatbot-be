import { StateGraph, START, END } from "@langchain/langgraph";
import {
  RoleplayGraphStateSchema,
  type RoleplayGraphState,
} from "../graphState/roleplayGraphState";
import type { RoleplayGraphDeps } from "./roleplayGraph";

export type { RoleplayGraphDeps };

/**
 * Result of the pre-generation graph execution.
 * Fields are `undefined` when their corresponding node did not run or failed.
 */
export interface PreGenerationResult {
  session: unknown;
  characterContext: unknown;
  resolvedContext: unknown;
  promptContext: unknown;
  /** Accumulated errors keyed by graph-node stage name. */
  errors: Array<{ stage: string; message: string }> | undefined;
}

/**
 * Create a compiled sub-graph that runs only the pre-generation pipeline:
 *
 *   loadSession -> loadCharacterContext -> resolveContext -> buildPrompt -> END
 *
 * If any node fails, the error is captured with its stage name and the graph
 * short-circuits to END. No generation, persistence, post-turn wake, or SSE
 * emission is performed.
 *
 * @param deps - Injected dependencies matching `RoleplayGraphDeps`.
 *               Only `loadSession`, `loadCharacterContext`, `resolveContext`,
 *               and `buildPromptContext` are used by this sub-graph.
 */
export function createRoleplayPreGenerationGraph(
  deps: RoleplayGraphDeps,
) {
  // ---- nodes ---------------------------------------------------------------

  async function loadSessionNode(
    state: RoleplayGraphState,
  ): Promise<Partial<RoleplayGraphState>> {
    try {
      const session = await deps.loadSession(state.sessionId);
      return { session };
    } catch (err) {
      return {
        errors: [
          {
            stage: "loadSession",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }
  }

  async function loadCharacterContextNode(
    state: RoleplayGraphState,
  ): Promise<Partial<RoleplayGraphState>> {
    if (!state.session) return {};

    try {
      const characterContext = await deps.loadCharacterContext({
        session: state.session,
      });
      return { characterContext };
    } catch (err) {
      return {
        errors: [
          {
            stage: "loadCharacterContext",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
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
        errors: [
          {
            stage: "resolveContext",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }
  }

  async function buildPromptNode(
    state: RoleplayGraphState,
  ): Promise<Partial<RoleplayGraphState>> {
    if (!state.characterContext || !state.session || !state.resolvedContext) {
      return {};
    }

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
        errors: [
          {
            stage: "buildPrompt",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }
  }

  // ---- conditional routing -------------------------------------------------

  function hasErrors(state: RoleplayGraphState): string {
    if (state.errors && state.errors.length > 0) {
      return "__error__";
    }
    return "__next__";
  }

  // ---- graph construction --------------------------------------------------

  return new StateGraph(RoleplayGraphStateSchema)
    .addNode("loadSession", loadSessionNode)
    .addNode("loadCharacterContext", loadCharacterContextNode)
    .addNode("resolveContext", resolveContextNode)
    .addNode("buildPrompt", buildPromptNode)
    .addConditionalEdges(START, hasErrors, {
      __error__: END,
      __next__: "loadSession",
    })
    .addConditionalEdges("loadSession", hasErrors, {
      __error__: END,
      __next__: "loadCharacterContext",
    })
    .addConditionalEdges("loadCharacterContext", hasErrors, {
      __error__: END,
      __next__: "resolveContext",
    })
    .addConditionalEdges("resolveContext", hasErrors, {
      __error__: END,
      __next__: "buildPrompt",
    })
    .addEdge("buildPrompt", END)
    .compile();
}

/**
 * Convenience wrapper: create a pre-generation graph with the supplied deps,
 * invoke it with the input, and return a `PreGenerationResult` containing the
 * loaded context fields and any errors.
 */
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

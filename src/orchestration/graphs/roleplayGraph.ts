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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<any>;
  buildPromptContext: (
    input: BuildRoleplayPromptContextInput,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<any>;
  runGeneration: (
    input: RoleplayGenerationInput,
  ) => AsyncGenerator<RoleplayGenerationEvent>;
  persistTurn: (
    input: PersistRoleplayTurnInput,
  ) => Promise<PersistRoleplayTurnOutput>;
  generationModelBinding: ModelBinding;
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
};

// ---------------------------------------------------------------------------
// Roleplay graph factory
// ---------------------------------------------------------------------------

/**
 * Create a compiled coarse roleplay graph.
 *
 * Nodes wrap the extracted Phase 2.5 adapters. The graph is not wired to
 * production routes in this task — it exists for trace inspection and
 * unit-test verification.
 *
 * @param deps - Injected dependencies. Supply fakes in unit tests to avoid
 *               DB/LLM/provider calls. Defaults to production implementations.
 */
export function createRoleplayGraph(
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

  async function generateAndValidateNode(
    state: RoleplayGraphState,
  ): Promise<Partial<RoleplayGraphState>> {
    if (!state.promptContext || !state.session || !state.characterContext) {
      return {};
    }

    try {
      const events: RoleplayGenerationEvent[] = [];
      let generationResult: unknown = undefined;

      for await (const ev of deps.runGeneration({
        promptContext: state.promptContext,
        userMessage: state.userMessage,
        session: state.session,
        personaOverlay: state.characterContext.personaOverlay,
        thoughtSummaryCache: new Map(),
        thoughtsAcc: [],
        isFirstUserTurn: false,
      })) {
        if (ev.event === "_complete") {
          generationResult = ev.data;
        } else {
          // Collect non-_complete events for trace/test inspection.
          // RoleplayGenerationEvent structurally excludes "delta", so raw
          // draft deltas cannot reach this node.
          events.push(ev);
        }
      }

      if (!generationResult) {
        return {
          generationEvents: events,
          errors: [
            {
              stage: "generateAndValidate",
              message: "generation did not complete",
            },
          ],
        };
      }

      return { generationResult, generationEvents: events };
    } catch (err) {
      return {
        errors: [
          {
            stage: "generateAndValidate",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }
  }

  async function persistTurnNode(
    state: RoleplayGraphState,
  ): Promise<Partial<RoleplayGraphState>> {
    if (
      !state.session ||
      !state.generationResult ||
      !state.resolvedContext
    ) {
      return {};
    }

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
        errors: [
          {
            stage: "persistTurn",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }
  }

  // ---- error sink ----------------------------------------------------------

  function errorSinkNode(
    _state: RoleplayGraphState,
  ): Partial<RoleplayGraphState> {
    return {};
  }

  // ---- conditional routing -------------------------------------------------

  function afterGenerationCondition(
    state: RoleplayGraphState,
  ): string {
    if (state.errors && state.errors.length > 0) {
      return "__error__";
    }
    // Persist only when generation produced a result.
    if (!state.generationResult) {
      return "__error__";
    }
    return "persistTurn";
  }

  const routeMap = {
    persistTurn: "persistTurn" as const,
    __error__: "errorSink" as const,
  };

  // ---- graph construction --------------------------------------------------

  return new StateGraph(RoleplayGraphStateSchema)
    .addNode("loadSession", loadSessionNode)
    .addNode("loadCharacterContext", loadCharacterContextNode)
    .addNode("resolveContext", resolveContextNode)
    .addNode("buildPrompt", buildPromptNode)
    .addNode("generateAndValidate", generateAndValidateNode)
    .addNode("persistTurn", persistTurnNode)
    .addNode("errorSink", errorSinkNode)
    .addEdge(START, "loadSession")
    .addEdge("loadSession", "loadCharacterContext")
    .addEdge("loadCharacterContext", "resolveContext")
    .addEdge("resolveContext", "buildPrompt")
    .addEdge("buildPrompt", "generateAndValidate")
    .addConditionalEdges(
      "generateAndValidate",
      afterGenerationCondition,
      routeMap,
    )
    .addEdge("persistTurn", END)
    .addEdge("errorSink", END)
    .compile();
}

/** Default roleplay graph instance. */
export const roleplayGraph = createRoleplayGraph();

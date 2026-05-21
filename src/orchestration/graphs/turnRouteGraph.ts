import { StateGraph, START, END } from "@langchain/langgraph";
import { runCharacterTurn } from "../turn/runCharacterTurn";
import { classifyTurnRoute as defaultClassifyTurnRoute } from "../turn/classifyTurnRoute";
import {
  loadSessionImpl,
} from "./routeGraphDeps";
import type { ClassifyTurnRouteInput } from "../turn/classifyTurnRoute";
import type { TurnRouteClassification } from "../turn/classifyTurnRoute";
import type { ChatSession } from "../../db/schema/chat";
import type { TurnInput } from "../turn/runCharacterTurn";
import type { TurnOutput } from "../turn/runCharacterTurn";
import {
  TurnRouteGraphStateSchema,
  type TurnRouteGraphState,
} from "../graphState/turnRouteGraphState";

// ---------------------------------------------------------------------------
// Dependency injection shape
// ---------------------------------------------------------------------------

export interface RouteGraphDeps {
  loadSession: (sessionId: string) => Promise<ChatSession>;
  classifyTurnRoute: (
    input: ClassifyTurnRouteInput,
  ) => Promise<TurnRouteClassification>;
  runRoleplayTurn: (input: TurnInput) => Promise<TurnOutput>;
  runAppCommand: (input: TurnInput) => Promise<TurnOutput>;
  runUnsupportedTurn: (input: TurnInput) => Promise<TurnOutput>;
}

// ---------------------------------------------------------------------------
// Default production dependencies
// ---------------------------------------------------------------------------

export const defaultRouteGraphDeps: RouteGraphDeps = {
  loadSession: loadSessionImpl,
  classifyTurnRoute: defaultClassifyTurnRoute,
  runRoleplayTurn: runCharacterTurn,
  runAppCommand: async () => {
    throw new Error("App-command branch not wired in Task Group 1");
  },
  runUnsupportedTurn: async () => {
    throw new Error("Unsupported-turn branch not wired in Task Group 1");
  },
};

// ---------------------------------------------------------------------------
// Route-branch graph factory
// ---------------------------------------------------------------------------

/**
 * Create a compiled route-branch turn graph.
 *
 * @param deps - Injected dependencies.  Supply fakes in unit tests to avoid
 *                DB/LLM/provider calls.  Defaults to production implementations
 *                where available (loadSession, classifyTurnRoute, roleplay).
 */
export function createTurnRouteGraph(deps: RouteGraphDeps = defaultRouteGraphDeps) {
  // ---- nodes ---------------------------------------------------------------

  async function loadSessionNode(
    state: TurnRouteGraphState,
  ): Promise<Partial<TurnRouteGraphState>> {
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

  async function classifyTurnRouteNode(
    state: TurnRouteGraphState,
  ): Promise<Partial<TurnRouteGraphState>> {
    if (!state.session) return {};

    try {
      const routeIntent = await deps.classifyTurnRoute({
        session: state.session,
        userMessage: state.userMessage,
      });
      return { routeIntent };
    } catch (err) {
      return {
        errors: [
          {
            stage: "classifyTurnRoute",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }
  }

  function routeSwitchNode(
    state: TurnRouteGraphState,
  ): Partial<TurnRouteGraphState> {
    if (!state.routeIntent) {
      // Previous node already recorded an error; routeSwitch not needed.
      return {};
    }
    return { route: state.routeIntent.type };
  }

  async function roleplayTurnNode(
    state: TurnRouteGraphState,
  ): Promise<Partial<TurnRouteGraphState>> {
    try {
      const result = await deps.runRoleplayTurn({
        sessionId: state.sessionId,
        userMessage: state.userMessage,
      });
      return { result };
    } catch (err) {
      return {
        errors: [
          {
            stage: "roleplayTurn",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }
  }

  async function appCommandNode(
    state: TurnRouteGraphState,
  ): Promise<Partial<TurnRouteGraphState>> {
    try {
      const result = await deps.runAppCommand({
        sessionId: state.sessionId,
        userMessage: state.userMessage,
      });
      return { result };
    } catch (err) {
      return {
        errors: [
          {
            stage: "appCommand",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }
  }

  async function unsupportedTurnNode(
    state: TurnRouteGraphState,
  ): Promise<Partial<TurnRouteGraphState>> {
    try {
      const result = await deps.runUnsupportedTurn({
        sessionId: state.sessionId,
        userMessage: state.userMessage,
      });
      return { result };
    } catch (err) {
      return {
        errors: [
          {
            stage: "unsupportedTurn",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }
  }

  // ---- sink node for early-error termination --------------------------------

  function errorSinkNode(
    _state: TurnRouteGraphState,
  ): Partial<TurnRouteGraphState> {
    // Terminal — no-op. The error was already recorded upstream.
    return {};
  }

  // ---- conditional router --------------------------------------------------

  function routeCondition(state: TurnRouteGraphState): string {
    if (state.errors && state.errors.length > 0) {
      return "__error__";
    }
    return state.route ?? "roleplay_turn";
  }

  const routeMap = {
    roleplay_turn: "roleplayTurn" as const,
    app_command: "appCommand" as const,
    unsupported: "unsupportedTurn" as const,
    __error__: "errorSink" as const,
  };

  // ---- graph construction --------------------------------------------------

  return new StateGraph(TurnRouteGraphStateSchema)
    .addNode("loadSession", loadSessionNode)
    .addNode("classifyTurnRoute", classifyTurnRouteNode)
    .addNode("routeSwitch", routeSwitchNode)
    .addNode("roleplayTurn", roleplayTurnNode)
    .addNode("appCommand", appCommandNode)
    .addNode("unsupportedTurn", unsupportedTurnNode)
    .addNode("errorSink", errorSinkNode)
    .addEdge(START, "loadSession")
    .addEdge("loadSession", "classifyTurnRoute")
    .addEdge("classifyTurnRoute", "routeSwitch")
    .addConditionalEdges("routeSwitch", routeCondition, routeMap)
    .addEdge("roleplayTurn", END)
    .addEdge("appCommand", END)
    .addEdge("unsupportedTurn", END)
    .addEdge("errorSink", END)
    .compile();
}

/** Default route-branch graph instance. */
export const turnRouteGraph = createTurnRouteGraph();

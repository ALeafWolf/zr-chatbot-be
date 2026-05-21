import { StateGraph, START, END } from "@langchain/langgraph";
import { runCharacterTurn } from "../turn/runCharacterTurn";
import type { TurnInput } from "../turn/runCharacterTurn";
import {
  TurnGraphStateSchema,
  type TurnGraphState,
} from "../graphState/turnGraphState";

/** Runner function signature used by the turn graph. */
export type TurnRunner = (input: TurnInput) => Promise<{
  assistantMessageId: string;
  content: string;
  wasRewritten: boolean;
  wasDeflected: boolean;
  turnIndex: number;
  route: string;
}>;

/**
 * Create a compiled one-node turn graph.
 *
 * @param runTurn - The turn runner to invoke. Defaults to the real `runCharacterTurn`.
 *                   Inject a fake runner in unit tests to avoid DB/LLM/provider calls.
 */
export function createTurnGraph(runTurn: TurnRunner = runCharacterTurn) {
  async function runExistingCharacterTurnNode(
    state: TurnGraphState,
  ): Promise<Partial<TurnGraphState>> {
    try {
      const result = await runTurn({
        sessionId: state.sessionId,
        userMessage: state.userMessage,
      });
      return { result };
    } catch (err) {
      return {
        errors: [
          {
            stage: "runExistingCharacterTurn",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }
  }

  return new StateGraph(TurnGraphStateSchema)
    .addNode("runExistingCharacterTurn", runExistingCharacterTurnNode)
    .addEdge(START, "runExistingCharacterTurn")
    .addEdge("runExistingCharacterTurn", END)
    .compile();
}

/** Default turn graph instance backed by the real `runCharacterTurn`. */
export const turnGraph = createTurnGraph();

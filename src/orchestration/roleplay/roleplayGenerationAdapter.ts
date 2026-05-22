import type { Thought } from "../thought/thoughtTypes";
import type { ChatSession } from "../../db/schema/chat";
import type { PersonaOverlayDefaults } from "../../character/characterDefaults";
import type { PromptContext } from "../prompt/buildPromptContext";
import {
  generateAndValidateStream,
  type GenerateAndValidateResult,
} from "../generation/generateAndValidate";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RoleplayGenerationEvent =
  | { event: "thought"; data: Thought }
  | {
      event: "tool_call";
      data: { id: string; name: string; args: unknown };
    }
  | {
      event: "tool_result";
      data: { id: string; name: string; summary: string };
    }
  | { event: "_complete"; data: GenerateAndValidateResult };

export interface RoleplayGenerationInput {
  promptContext: PromptContext;
  userMessage: string;
  session: ChatSession;
  personaOverlay: PersonaOverlayDefaults;
  signal?: AbortSignal;
  thoughtSummaryCache: Map<string, string>;
  thoughtsAcc: Thought[];
  isFirstUserTurn: boolean;
  /** Optional callback to check and emit a ready recall thought before each mapped event. */
  takeReadyRecallThought?: () => Thought | null;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Consumes {@link generateAndValidateStream}, maps its orchestration events
 * to frontend-safe chat events, suppresses raw draft deltas, captures the
 * final generation result, and returns early on abort.
 *
 * The caller owns:
 * - recall thought task creation and final wait
 * - persisted route selection, cost estimation
 * - {@link persistCompletedTurn}, late recall thought persistence
 * - final prose replay and `done` payload
 */
export async function* runRoleplayGenerationAdapter(
  input: RoleplayGenerationInput,
  deps?: {
    generateAndValidate?: typeof generateAndValidateStream;
  },
): AsyncGenerator<RoleplayGenerationEvent> {
  const genStream = deps?.generateAndValidate ?? generateAndValidateStream;

  if (input.signal?.aborted) {
    return;
  }

  for await (const ev of genStream({
    promptContext: input.promptContext,
    userMessage: input.userMessage,
    session: input.session,
    personaOverlay: input.personaOverlay,
    signal: input.signal,
    thoughtSummaryCache: input.thoughtSummaryCache,
    thoughtsOut: input.thoughtsAcc,
    isFirstUserTurn: input.isFirstUserTurn,
  })) {
    if (input.signal?.aborted) {
      return;
    }

    // Queue any ready recall thought before forwarding the generation event.
    const recallThought = input.takeReadyRecallThought?.();
    if (recallThought) {
      yield { event: "thought", data: recallThought };
    }

    switch (ev.type) {
      case "thought":
        yield { event: "thought", data: ev.thought };
        break;
      case "delta":
        // Final prose is replayed only after validation and DB persistence.
        break;
      case "tool_call":
        yield {
          event: "tool_call",
          data: { id: ev.id, name: ev.name, args: ev.args },
        };
        break;
      case "tool_result":
        yield {
          event: "tool_result",
          data: { id: ev.id, name: ev.name, summary: ev.summary },
        };
        break;
      case "_complete":
        yield { event: "_complete", data: ev.result };
        break;
      default:
        break;
    }
  }
}

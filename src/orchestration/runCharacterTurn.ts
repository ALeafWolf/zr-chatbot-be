import { db } from "../db/client";
import { chatSessions } from "../db/schema/chat";
import { eq } from "drizzle-orm";
import {
  loadCharacterDefaults,
  loadPersonaOverlay,
} from "../character/characterDefaults";
import { resolveContext } from "./resolveContext";
import { buildPromptContext } from "./buildPromptContext";
import { generateAndValidateStream } from "./generateAndValidate";
import { postTurnRunner } from "../jobs/postTurnRunner";
import type { ChatSession } from "../db/schema/chat";
import { CANON_RETRIEVAL } from "../character/canonRules";
import { traceStage } from "../observability/langsmithTracing";
import type { Thought } from "./thoughtTypes";
import { generateThoughtSummary } from "../llm/generation/generateThoughtSummary";
import { persistCompletedTurn } from "./turnPersistence";

export interface TurnInput {
  sessionId: string;
  userMessage: string;
}

export interface TurnOutput {
  assistantMessageId: string;
  content: string;
  wasRewritten: boolean;
  wasDeflected: boolean;
  turnIndex: number;
}

export type CharacterTurnSseEvent =
  | { event: "thought"; data: Thought }
  | { event: "tool_call"; data: { id: string; name: string; args: unknown } }
  | {
      event: "tool_result";
      data: { id: string; name: string; summary: string };
    }
  | { event: "delta"; data: { text: string } }
  | {
      event: "done";
      data: {
        message_id: string;
        content: string;
        turn_index: number;
        was_rewritten: boolean;
        was_deflected: boolean;
        thoughts: Thought[];
      };
    }
  | { event: "error"; data: { message: string } };

const FINAL_REPLY_REPLAY_SLICE = 96;

function voiceHintsFrom(characterDefaults: ReturnType<typeof loadCharacterDefaults>): string {
  const s = characterDefaults.speech_style;
  return [s.formality, s.emotionality, ...(s.preferred_patterns ?? [])].join(
    "，",
  );
}

/**
 * Phase 1 turn flow with incremental SSE events (`thought`, `tool_*`, `delta`, then `done`).
 * Abort via `signal` skips persistence if the turn did not finish cleanly.
 */
export async function* runCharacterTurnStream(
  input: TurnInput & { signal?: AbortSignal },
): AsyncGenerator<CharacterTurnSseEvent> {
  const { sessionId, userMessage, signal } = input;

  try {
    const sessionRows = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.sessionId, sessionId))
      .limit(1);

    if (!sessionRows[0]) {
      yield { event: "error", data: { message: `Session not found: ${sessionId}` } };
      return;
    }
    const session: ChatSession = sessionRows[0];

    if (session.deletedAt) {
      yield {
        event: "error",
        data: { message: `Session ${sessionId} has been deleted` },
      };
      return;
    }

    const characterDefaults = loadCharacterDefaults(session.characterId);
    const overlayId = session.personaOverlayId ?? `${session.continuityScope}`;
    const personaOverlay = loadPersonaOverlay(overlayId);
    const voiceHints = voiceHintsFrom(characterDefaults);

    const context = await resolveContext({
      session,
      userMessage,
      characterDefaults,
    });

    const promptContext = buildPromptContext({
      characterDefaults,
      personaOverlay,
      session,
      derivedState: context.derivedState,
      memories: context.memories,
      canonChunks: context.canonChunks,
      canonScenes: context.canonScenes,
      recentTurns: context.recentTurns,
      sessionSummary: context.sessionSummary,
      sessionRecall: context.sessionRecall,
      structMemEntries: context.structMemEntries,
      structMemConsolidations: context.structMemConsolidations,
      userMessage,
      queryRewrite: context.queryRewrite,
    });

    const thoughtSummaryCache = new Map<string, string>();
    const thoughtsAcc: Thought[] = [];

    const canonExcerptsForThought =
      context.canonScenes.length > 0
        ? context.canonScenes
            .flatMap((s) => s.units.map((u) => ({ excerpt: u.textContent.slice(0, 160) })))
            .slice(0, Math.max(8, CANON_RETRIEVAL.anchorTopK * 2))
        : context.canonChunks.slice(0, Math.max(8, CANON_RETRIEVAL.anchorTopK * 2)).map((c) => ({
            excerpt: c.textContent.slice(0, 160),
          }));

    if (context.memories.length > 0 || canonExcerptsForThought.length > 0) {
      const recallLine = await generateThoughtSummary(
        {
          characterName: characterDefaults.name,
          stage: "recall",
          context: {
            memories: context.memories.slice(0, 5).map((m) => ({
              type: m.memoryType,
              summary: m.summary,
            })),
            canon: canonExcerptsForThought,
          },
          voiceHints,
        },
        thoughtSummaryCache,
      );
      const recallThought: Thought = {
        kind: "recall",
        text: recallLine,
        ts: Date.now(),
      };
      thoughtsAcc.push(recallThought);
      yield { event: "thought", data: recallThought };
    }

    let resultPayload:
      | {
          content: string;
          validatorResult: unknown;
          wasRewritten: boolean;
          wasDeflected: boolean;
          inputTokens: number;
          outputTokens: number;
        }
      | undefined;

    for await (const ev of generateAndValidateStream({
      promptContext,
      userMessage,
      session,
      personaOverlay,
      signal,
      thoughtSummaryCache,
      thoughtsOut: thoughtsAcc,
    })) {
      if (signal?.aborted) {
        return;
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
            data: {
              id: ev.id,
              name: ev.name,
              summary: ev.summary,
            },
          };
          break;
        case "_complete":
          resultPayload = ev.result;
          break;
        default:
          break;
      }
    }

    if (signal?.aborted || !resultPayload) {
      return;
    }

    const result = resultPayload;

    const persisted = await persistCompletedTurn({
      session,
      userMessage,
      assistantReply: result.content,
      validatorResult: result.validatorResult,
      derivedState: context.derivedState,
      memories: context.memories,
      thoughts: thoughtsAcc,
    });

    postTurnRunner.wake();

    for (let i = 0; i < result.content.length; i += FINAL_REPLY_REPLAY_SLICE) {
      yield {
        event: "delta",
        data: {
          text: result.content.slice(i, i + FINAL_REPLY_REPLAY_SLICE),
        },
      };
    }

    yield {
      event: "done",
      data: {
        message_id: persisted.assistantMessageId,
        content: result.content,
        turn_index: persisted.assistantTurnIndex,
        was_rewritten: result.wasRewritten,
        was_deflected: result.wasDeflected,
        thoughts: thoughtsAcc,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { event: "error", data: { message } };
  }
}

export interface StreamTurnInput extends TurnInput {
  signal?: AbortSignal;
  onEvent: (event: CharacterTurnSseEvent) => void | Promise<void>;
}

async function _runCharacterTurnStreamTraced(input: StreamTurnInput): Promise<void> {
  for await (const event of runCharacterTurnStream({
    sessionId: input.sessionId,
    userMessage: input.userMessage,
    signal: input.signal,
  })) {
    await input.onEvent(event);
  }
}

export const runCharacterTurnStreamTraced = traceStage(
  "orchestration.run_character_turn_stream",
  _runCharacterTurnStreamTraced,
);

async function _runCharacterTurn(input: TurnInput): Promise<TurnOutput> {
  let output: TurnOutput | undefined;
  for await (const ev of runCharacterTurnStream(input)) {
    if (ev.event === "done") {
      output = {
        assistantMessageId: ev.data.message_id,
        content: ev.data.content,
        wasRewritten: ev.data.was_rewritten,
        wasDeflected: ev.data.was_deflected,
        turnIndex: ev.data.turn_index,
      };
    }
    if (ev.event === "error") {
      throw new Error(ev.data.message);
    }
  }
  if (!output) {
    throw new Error("Turn ended without a completion event");
  }
  return output;
}

export const runCharacterTurn = traceStage(
  "orchestration.run_character_turn",
  _runCharacterTurn,
);

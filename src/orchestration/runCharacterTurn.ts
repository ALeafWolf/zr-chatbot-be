import { v4 as uuidv4 } from "uuid";
import { db } from "../db/client";
import { chatMessages, chatSessions } from "../db/schema/chat";
import { eq } from "drizzle-orm";
import {
  loadCharacterDefaults,
  loadPersonaOverlay,
} from "../character/characterDefaults";
import { resolveContext } from "./resolveContext";
import { buildPromptContext } from "./buildPromptContext";
import { generateAndValidateStream } from "./generateAndValidate";
import { upsertSessionState } from "../state/sessionStateRepo";
import { postTurnRunner } from "../jobs/postTurnRunner";
import type { ChatSession } from "../db/schema/chat";
import { CANON_RETRIEVAL } from "../character/canonRules";
import { traceStage } from "../observability/langsmithTracing";
import type { Thought } from "./thoughtTypes";
import { generateThoughtSummary } from "../llm/generateThoughtSummary";

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

function voiceHintsFrom(characterDefaults: ReturnType<typeof loadCharacterDefaults>): string {
  const s = characterDefaults.speech_style;
  return [s.formality, s.emotionality, ...(s.preferred_patterns ?? [])].join(
    "；",
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
      recentTurns: context.recentTurns,
      sessionSummary: context.sessionSummary,
      sessionRecall: context.sessionRecall,
    });

    const thoughtSummaryCache = new Map<string, string>();
    const thoughtsAcc: Thought[] = [];

    if (context.memories.length > 0 || context.canonChunks.length > 0) {
      const recallLine = await generateThoughtSummary(
        {
          characterName: characterDefaults.name,
          stage: "recall",
          context: {
            memories: context.memories.slice(0, 5).map((m) => ({
              type: m.memoryType,
              summary: m.summary,
            })),
            canon: context.canonChunks
              .slice(0, Math.max(8, CANON_RETRIEVAL.anchorTopK * 2))
              .map((c) => ({
                excerpt: c.textContent.slice(0, 160),
              })),
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
          yield { event: "delta", data: { text: ev.text } };
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

    const nextTurnIndex =
      (context.recentTurns[context.recentTurns.length - 1]?.turnIndex ?? -1) + 1;
    const userMsgId = uuidv4();
    const assistantMsgId = uuidv4();

    await db.insert(chatMessages).values([
      {
        id: userMsgId,
        sessionId,
        turnIndex: nextTurnIndex,
        role: "user",
        content: userMessage,
        validatorResult: null,
        thoughts: null,
      },
      {
        id: assistantMsgId,
        sessionId,
        turnIndex: nextTurnIndex + 1,
        role: "assistant",
        content: result.content,
        validatorResult: result.validatorResult as unknown as Record<
          string,
          unknown
        >,
        thoughts: thoughtsAcc.length > 0 ? thoughtsAcc : null,
      },
    ]);

    await upsertSessionState(sessionId, {
      derivedState: context.derivedState,
      lastTurnIndex: nextTurnIndex + 1,
    });

    await db
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.sessionId, sessionId));

    const shouldWriteMemory = session.writebackPolicy !== "no_writeback";
    postTurnRunner.enqueue({
      sessionId,
      userMessage,
      assistantReply: result.content,
      session,
      memories: context.memories,
      derivedState: context.derivedState,
      shouldWriteMemory,
      latestTurnIndex: nextTurnIndex + 1,
    });

    yield {
      event: "done",
      data: {
        message_id: assistantMsgId,
        content: result.content,
        turn_index: nextTurnIndex + 1,
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

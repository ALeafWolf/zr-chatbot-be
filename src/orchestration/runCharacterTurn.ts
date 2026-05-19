import { db } from "../db/client";
import { chatSessions } from "../db/schema/chat";

import { eq } from "drizzle-orm";
import {
  loadCharacterDefaults,
  loadPersonaOverlay,
} from "../character/characterDefaults";
import { classifyTurnRoute } from "./classifyTurnRoute";
import { resolveContext } from "./resolveContext";
import { buildPromptContextTraced } from "./buildPromptContext";
import { generateAndValidateStream } from "./generateAndValidate";
import { postTurnRunner } from "../jobs/postTurnRunner";
import type { ChatSession } from "../db/schema/chat";
import {
  traceLLMStage,
  traceStage,
  withTraceContext,
} from "../observability/langsmithTracing";
import {
  attachTraceLlmMetadata,
  buildTraceBaseMetadata,
} from "../observability/traceMetadata";
import { models } from "../config/models";
import type { Thought } from "./thoughtTypes";
import {
  generateThoughtSummary,
  generateThoughtSummaryWithUsage,
} from "../llm/generation/generateThoughtSummary";
import {
  persistCompletedTurn,
  updateAssistantMessageThoughts,
} from "./turnPersistence";
import {
  APP_COMMAND_ROUTE,
  ROLEPLAY_TURN_ROUTE,
  UNSUPPORTED_ROUTE,
  persistedRouteForRoleplayResult,
  type TurnRoute,
} from "./turnRoutes";
import {
  createRecallThoughtTask,
  takeReadyRecallThought,
  waitForRecallThought,
} from "./recallThoughtTask";

type RecallThoughtTraceInput = {
  characterName: string;
  context: {
    selected: Array<{ source: string; text: string }>;
  };
  voiceHints: string;
  cache: Map<string, string>;
  traceState: { timedOutBeforeFinalReplay: boolean };
  selectionMode: string;
};

type RecallThoughtTraceOutput = {
  text: string;
  selectedContextCount: number;
  selectionMode: string;
  countsBySource: Partial<Record<string, number>>;
  outputChars: number;
  timedOutBeforeFinalReplay: boolean;
};

const tracedRecallThought = traceLLMStage(
  "llm.recall_thought",
  async (input: RecallThoughtTraceInput): Promise<RecallThoughtTraceOutput> => {
    const thought = await generateThoughtSummaryWithUsage(
      {
        characterName: input.characterName,
        stage: "recall",
        context: input.context,
        voiceHints: input.voiceHints,
      },
      input.cache,
    );
    const selected = input.context.selected;
    const countsBySource: Partial<Record<string, number>> = {};
    for (const s of selected) {
      countsBySource[s.source] = (countsBySource[s.source] ?? 0) + 1;
    }
    const output = {
      text: thought.text,
      selectedContextCount: selected.length,
      selectionMode: input.selectionMode,
      countsBySource,
      outputChars: thought.text.length,
      timedOutBeforeFinalReplay: input.traceState.timedOutBeforeFinalReplay,
    };
    if (thought.cacheHit) return output;
    return attachTraceLlmMetadata(output, {
      binding: models.extractor,
      modelRole: "extractor",
      usage: {
        inputTokens: thought.inputTokens,
        outputTokens: thought.outputTokens,
      },
    });
  },
  {
    subsystem: "llm",
    turn: "foreground",
    llm: { binding: models.extractor, modelRole: "extractor" },
    processInputs: (inputs) => {
      const input = unwrapRecallThoughtInput(inputs);
      const selected = input.context.selected;
      const canonCount = selected.filter(
        (s) => s.source === "canon_chunk" || s.source === "canon_scene",
      ).length;
      return {
        selectedContextCount: selected.length,
        canonContextCount: canonCount,
        memoryContextCount: selected.length - canonCount,
        sources: selected.map((s) => s.source).join(","),
      };
    },
    processOutputs: (outputs) => {
      const out = outputs as unknown as RecallThoughtTraceOutput;
      return {
        selectedContextCount: out.selectedContextCount,
        selectionMode: out.selectionMode,
        countsBySource: JSON.stringify(out.countsBySource),
        outputChars: out.outputChars,
        timedOutBeforeFinalReplay: out.timedOutBeforeFinalReplay,
      };
    },
  },
);

function unwrapRecallThoughtInput(
  inputs: Record<string, unknown>,
): RecallThoughtTraceInput {
  if ("input" in inputs && inputs.input) {
    return inputs.input as RecallThoughtTraceInput;
  }
  return inputs as unknown as RecallThoughtTraceInput;
}

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
  route: TurnRoute;
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
        route: TurnRoute;
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

async function loadSessionImpl(sessionId: string): Promise<ChatSession> {
  const sessionRows = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.sessionId, sessionId))
    .limit(1);

  if (!sessionRows[0]) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const session: ChatSession = sessionRows[0];
  if (session.deletedAt) {
    throw new Error(`Session ${sessionId} has been deleted`);
  }

  return session;
}

const loadSession = traceStage("orchestration.load_session", loadSessionImpl, {
  subsystem: "orchestration",
  turn: "foreground",
  processInputs: (inputs) => ({ sessionId: String(inputs[0] ?? "") }),
  processOutputs: (outputs) => {
    const session = outputs as unknown as ChatSession;
    return {
      sessionId: session.sessionId,
      characterId: session.characterId,
      mode: session.mode,
    };
  },
});

const tracedRouteSwitch = traceStage(
  "orchestration.route_switch",
  async (input: {
    classifiedRoute: TurnRoute;
    persistedRoute?: TurnRoute;
    confidence?: number;
    fallbackReason?: string;
  }) => input,
  { subsystem: "orchestration", turn: "foreground" },
);

const tracedRoleplayTurn = traceStage(
  "orchestration.roleplay_turn",
  async (input: { sessionId: string; userMessageChars: number }) => input,
  { subsystem: "orchestration", turn: "foreground" },
);

const tracedAppCommandTurn = traceStage(
  "orchestration.app_command",
  async (input: { sessionId: string; userMessageChars: number }) => input,
  { subsystem: "orchestration", turn: "foreground" },
);

const tracedUnsupportedTurn = traceStage(
  "orchestration.unsupported_turn",
  async (input: { sessionId: string; userMessageChars: number }) => input,
  { subsystem: "orchestration", turn: "foreground" },
);

/**
 * Phase 1 turn flow with incremental SSE events (`thought`, `tool_*`, `delta`, then `done`).
 * Abort via `signal` skips persistence if the turn did not finish cleanly.
 */
async function* runRoleplayTurnStream(
  input: TurnInput & { session: ChatSession; signal?: AbortSignal },
): AsyncGenerator<CharacterTurnSseEvent> {
  const { session, userMessage, signal } = input;

  try {
    await tracedRoleplayTurn({
      sessionId: session.sessionId,
      userMessageChars: userMessage.length,
    });

    const characterDefaults = loadCharacterDefaults(session.characterId);
    const overlayId = session.personaOverlayId ?? `${session.continuityScope}`;
    const personaOverlay = loadPersonaOverlay(overlayId);
    const voiceHints = voiceHintsFrom(characterDefaults);

    const context = await resolveContext({
      session,
      userMessage,
      characterDefaults,
    });

    const promptContext = await buildPromptContextTraced({
      characterDefaults,
      personaOverlay,
      session,
      derivedState: context.derivedState,
      memories: context.memories,
      canonChunks: context.canonChunks,
      canonScenes: context.canonScenes,
      recentTurns: context.recentTurns,
      sessionSummary: context.sessionSummary,
      openThreads: context.openThreads,
      memoryCorrections: context.memoryCorrections,
      latestTurnDelta: context.latestTurnDelta,
      sessionRecall: context.sessionRecall,
      structMemEntries: context.structMemEntries,
      structMemEntryContextExpansions:
        context.structMemEntryContextExpansions,
      structMemConsolidations: context.structMemConsolidations,
      motifProbe: context.motifProbe,
      memoryRerank: context.rerankOutput,
      userMessage,
      queryRewrite: context.queryRewrite,
    });

    const thoughtSummaryCache = new Map<string, string>();
    const thoughtsAcc: Thought[] = [];
    const recallTraceState = { timedOutBeforeFinalReplay: false };

    const recallThoughtTask =
      context.recallThoughtContext.items.length > 0
        ? createRecallThoughtTask(async () => {
            const recallItems = context.recallThoughtContext.items;
            const recallRun = await tracedRecallThought(
              {
                characterName: characterDefaults.name,
                context: {
                  selected: recallItems.map((item) => ({
                    source: item.source,
                    text: item.text,
                  })),
                },
                voiceHints,
                cache: thoughtSummaryCache,
                traceState: recallTraceState,
                selectionMode: context.recallThoughtContext.selectionMode,
              },
            );
            return {
              kind: "recall",
              text: recallRun.text,
              ts: Date.now(),
            };
          })
        : undefined;

    const readyRecallThought = takeReadyRecallThought(recallThoughtTask);
    if (readyRecallThought) {
      thoughtsAcc.push(readyRecallThought);
      yield { event: "thought", data: readyRecallThought };
    }

    function persistLateRecallThought(assistantMessageId: string): void {
      if (!recallThoughtTask || recallThoughtTask.emitted) return;
      void recallThoughtTask.promise
        .then(async () => {
          const lateThought = takeReadyRecallThought(recallThoughtTask);
          if (!lateThought) return;
          thoughtsAcc.push(lateThought);
          await updateAssistantMessageThoughts({
            assistantMessageId,
            thoughts: thoughtsAcc,
          });
        })
        .catch((err) => {
          console.warn("[recallThought] late persistence failed:", err);
        });
    }

    function queueReadyRecallThought(): Thought | null {
      const recallThought = takeReadyRecallThought(recallThoughtTask);
      if (!recallThought) return null;
      thoughtsAcc.push(recallThought);
      return recallThought;
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

      const recallThought = queueReadyRecallThought();
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
    const finalRecallThought = await waitForRecallThought(recallThoughtTask);
    if (finalRecallThought.timedOut) {
      recallTraceState.timedOutBeforeFinalReplay = true;
    }
    if (finalRecallThought.thought) {
      thoughtsAcc.push(finalRecallThought.thought);
      yield { event: "thought", data: finalRecallThought.thought };
    }

    const persistedRoute = persistedRouteForRoleplayResult({
      wasDeflected: result.wasDeflected,
    });
    await tracedRouteSwitch({
      classifiedRoute: ROLEPLAY_TURN_ROUTE,
      persistedRoute,
    });

    const persisted = await persistCompletedTurn({
      session,
      userMessage,
      assistantReply: result.content,
      validatorResult: result.validatorResult,
      route: persistedRoute,
      derivedState: context.derivedState,
      memories: context.memories,
      thoughts: thoughtsAcc,
    });

    if (finalRecallThought.timedOut) {
      persistLateRecallThought(persisted.assistantMessageId);
    }

    if (persisted.jobId) {
      postTurnRunner.wake();
    }

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
        route: persistedRoute,
        thoughts: thoughtsAcc,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { event: "error", data: { message } };
  }
}

async function* replayPersistedContent(
  content: string,
): AsyncGenerator<CharacterTurnSseEvent> {
  for (let i = 0; i < content.length; i += FINAL_REPLY_REPLAY_SLICE) {
    yield {
      event: "delta",
      data: { text: content.slice(i, i + FINAL_REPLY_REPLAY_SLICE) },
    };
  }
}

async function* runAppCommandTurnStream(
  input: TurnInput & { session: ChatSession; signal?: AbortSignal },
): AsyncGenerator<CharacterTurnSseEvent> {
  const { session, userMessage, signal } = input;
  if (signal?.aborted) return;

  await tracedAppCommandTurn({
    sessionId: session.sessionId,
    userMessageChars: userMessage.length,
  });

  const content =
    "App command recognized. Command execution is not implemented yet.";
  const persisted = await persistCompletedTurn({
    session,
    userMessage,
    assistantReply: content,
    validatorResult: {
      route: APP_COMMAND_ROUTE,
      status: "not_implemented",
    },
    route: APP_COMMAND_ROUTE,
    thoughts: [],
  });

  if (signal?.aborted) return;

  yield* replayPersistedContent(content);
  yield {
    event: "done",
    data: {
      message_id: persisted.assistantMessageId,
      content,
      turn_index: persisted.assistantTurnIndex,
      was_rewritten: false,
      was_deflected: false,
      route: APP_COMMAND_ROUTE,
      thoughts: [],
    },
  };
}

async function* runUnsupportedTurnStream(
  input: TurnInput & { session: ChatSession; signal?: AbortSignal },
): AsyncGenerator<CharacterTurnSseEvent> {
  const { session, userMessage, signal } = input;
  if (signal?.aborted) return;

  await tracedUnsupportedTurn({
    sessionId: session.sessionId,
    userMessageChars: userMessage.length,
  });

  const characterDefaults = loadCharacterDefaults(session.characterId);
  const content = characterDefaults.safe_deflection;
  const persisted = await persistCompletedTurn({
    session,
    userMessage,
    assistantReply: content,
    validatorResult: {
      route: UNSUPPORTED_ROUTE,
      status: "safe_deflection",
    },
    route: UNSUPPORTED_ROUTE,
    thoughts: [],
  });

  if (signal?.aborted) return;

  yield* replayPersistedContent(content);
  yield {
    event: "done",
    data: {
      message_id: persisted.assistantMessageId,
      content,
      turn_index: persisted.assistantTurnIndex,
      was_rewritten: false,
      was_deflected: true,
      route: UNSUPPORTED_ROUTE,
      thoughts: [],
    },
  };
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
    const session = await loadSession(sessionId);
    const routeIntent = await classifyTurnRoute({ session, userMessage, signal });
    await tracedRouteSwitch({
      classifiedRoute: routeIntent.type,
      confidence: routeIntent.confidence,
      fallbackReason: routeIntent.fallbackReason,
    });

    switch (routeIntent.type) {
      case ROLEPLAY_TURN_ROUTE:
        yield* runRoleplayTurnStream({ session, sessionId, userMessage, signal });
        return;
      case APP_COMMAND_ROUTE:
        yield* runAppCommandTurnStream({ session, sessionId, userMessage, signal });
        return;
      case UNSUPPORTED_ROUTE:
        yield* runUnsupportedTurnStream({ session, sessionId, userMessage, signal });
        return;
      default:
        yield* runRoleplayTurnStream({ session, sessionId, userMessage, signal });
        return;
    }
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

async function loadTraceSession(sessionId: string): Promise<ChatSession | null> {
  const rows = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.sessionId, sessionId))
    .limit(1);
  return rows[0] ?? null;
}

const tracedRunCharacterTurnStream = traceStage(
  "orchestration.run_character_turn_stream",
  _runCharacterTurnStreamTraced,
  { root: true, subsystem: "orchestration" },
);

export async function runCharacterTurnStreamTraced(
  input: StreamTurnInput,
): Promise<void> {
  const session = await loadTraceSession(input.sessionId);
  return await withTraceContext(
    {
      baseMetadata: buildTraceBaseMetadata({ session }),
      characterId: session?.characterId,
      turn: "foreground",
    },
    async () => await tracedRunCharacterTurnStream(input),
  );
}

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
        route: ev.data.route,
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

const tracedRunCharacterTurn = traceStage(
  "orchestration.run_character_turn",
  _runCharacterTurn,
  { root: true, subsystem: "orchestration" },
);

export async function runCharacterTurn(input: TurnInput): Promise<TurnOutput> {
  const session = await loadTraceSession(input.sessionId);
  return await withTraceContext(
    {
      baseMetadata: buildTraceBaseMetadata({ session }),
      characterId: session?.characterId,
      turn: "foreground",
    },
    async () => await tracedRunCharacterTurn(input),
  );
}

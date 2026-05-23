import type { PreGenerationResult } from "./roleplayPreGenerationGraph";
import type { RoleplayGraphDeps } from "./roleplayGraph";
import type { RoleplayGenerationEvent, RoleplayGenerationInput } from "../roleplay/roleplayGenerationAdapter";
import type { PersistRoleplayTurnInput, PersistRoleplayTurnOutput } from "../roleplay/roleplayPersistenceAdapter";
import type { GenerateAndValidateResult } from "../generation/generateAndValidate";
import type { OrchestrationStreamEvent } from "../thought/thoughtTypes";
import type { ModelBinding } from "../../config/models";
import {
  createRecallThoughtTask,
  takeReadyRecallThought,
  waitForRecallThought,
} from "../thought/recallThoughtTask";
import type { Thought } from "../thought/thoughtTypes";
import type { ChatSession } from "../../db/schema/chat";
import type { CharacterTurnSseEvent, TurnInput } from "../turn/runCharacterTurn";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FINAL_REPLY_REPLAY_SLICE = 96;

// ---------------------------------------------------------------------------
// Dependency injection shape
// ---------------------------------------------------------------------------

export interface RoleplayGraphStreamAdapterDeps {
  /** Pre-generation graph runner. */
  runPreGeneration: (
    input: { sessionId: string; userMessage: string },
    deps: RoleplayGraphDeps,
  ) => Promise<PreGenerationResult>;
  /** Internal deps for the pre-generation graph. */
  preGenerationDeps: RoleplayGraphDeps;
  /** Generation adapter (default path). */
  runGeneration: (
    input: RoleplayGenerationInput,
  ) => AsyncGenerator<RoleplayGenerationEvent>;
  /**
   * Optional generation graph deps. When provided, the adapter builds a
   * generation subgraph and invokes it instead of `runGeneration`, making
   * validation/rewrite/deflection decisions visible in LangSmith traces.
   */
  generationGraphDeps?: import("./roleplayGraph").RoleplayGraphDeps;
  /** Turn persistence. */
  persistTurn: (
    input: PersistRoleplayTurnInput,
  ) => Promise<PersistRoleplayTurnOutput>;
  /** Model binding for cost estimation during persistence. */
  generationModelBinding: ModelBinding;
  /** Build a recall thought from resolved context items. */
  buildRecallThought: (input: {
    characterName: string;
    context: { selected: Array<{ source: string; text: string }> };
    voiceHints: string;
    cache: Map<string, string>;
    traceState: { timedOutBeforeFinalReplay: boolean };
    selectionMode: string;
  }) => Promise<{ text: string }>;
  /** Late recall thought persistence. */
  updateThoughts: (input: {
    assistantMessageId: string;
    thoughts: Thought[];
  }) => Promise<unknown>;
  /** Trace hook for the roleplay turn span. */
  traceRoleplayTurn: (input: {
    sessionId: string;
    userMessageChars: number;
  }) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Stream adapter
// ---------------------------------------------------------------------------

/**
 * Graph-backed roleplay turn stream adapter (Phase A sandwich pattern).
 *
 * Uses the pre-generation graph for session loading, character-context
 * resolution, and prompt building. The rest of the stream lifecycle (recall
 * thought task, generation adapter forwarding, final recall wait,
 * persistence, final prose replay, and `done`) remains in normal TypeScript
 * control flow, equivalent to the existing `runRoleplayTurnStream`.
 *
 * Not wired to production routing in this change. See Task Group 2/3 for
 * feature flag and production integration.
 */
export async function* runRoleplayTurnStreamViaGraph(
  input: TurnInput & { session: ChatSession; signal?: AbortSignal },
  deps: RoleplayGraphStreamAdapterDeps,
): AsyncGenerator<CharacterTurnSseEvent> {
  const { sessionId, userMessage, signal } = input;

  try {
    await deps.traceRoleplayTurn({
      sessionId,
      userMessageChars: userMessage.length,
    });

    // ---- Pre-generation graph ------------------------------------------------

    const preGenResult = await deps.runPreGeneration(
      { sessionId, userMessage },
      deps.preGenerationDeps,
    );

    if (preGenResult.errors && preGenResult.errors.length > 0) {
      yield {
        event: "error",
        data: {
          message: preGenResult.errors.map((e) => e.message).join("; "),
        },
      };
      return;
    }

    // Use the session loaded by the pre-generation graph, not the caller-supplied
    // one. This ensures the graph boundary is exercised correctly -- a missing
    // or diverged session stops the stream with an error.
    if (!preGenResult.session) {
      yield {
        event: "error",
        data: { message: "Pre-generation failed to load session" },
      };
      return;
    }

    const session = preGenResult.session as ChatSession;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const characterContext = preGenResult.characterContext as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const context = preGenResult.resolvedContext as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promptContext = preGenResult.promptContext as any;

    if (!characterContext || !context || !promptContext) {
      yield {
        event: "error",
        data: { message: "Pre-generation failed to produce required context" },
      };
      return;
    }

    const characterDefaults = characterContext.characterDefaults;
    const personaOverlay = characterContext.personaOverlay;
    const voiceHints = characterContext.voiceHints;

    // ---- Recall thought lifecycle -------------------------------------------

    const thoughtSummaryCache = new Map<string, string>();
    const thoughtsAcc: Thought[] = [];
    const recallTraceState = { timedOutBeforeFinalReplay: false };

    const recallThoughtTask =
      context.recallThoughtContext?.items?.length > 0
        ? createRecallThoughtTask(async () => {
            const recallItems = context.recallThoughtContext.items;
            const recallRun = await deps.buildRecallThought({
              characterName: characterDefaults.name,
              context: {
                selected: recallItems.map(
                  (item: { source: string; text: string }) => ({
                    source: item.source,
                    text: item.text,
                  }),
                ),
              },
              voiceHints,
              cache: thoughtSummaryCache,
              traceState: recallTraceState,
              selectionMode: context.recallThoughtContext.selectionMode,
            });
            return {
              kind: "recall" as const,
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

    // ---- Late recall persistence callback -----------------------------------

    function persistLateRecallThought(assistantMessageId: string): void {
      if (!recallThoughtTask || recallThoughtTask.emitted) return;
      void recallThoughtTask.promise
        .then(async () => {
          const lateThought = takeReadyRecallThought(recallThoughtTask);
          if (!lateThought) return;
          thoughtsAcc.push(lateThought);
          await deps.updateThoughts({
            assistantMessageId,
            thoughts: thoughtsAcc,
          });
        })
        .catch((err) => {
          console.warn("[recallThought] late persistence failed:", err);
        });
    }

    // ---- Interleave recall thoughts during generation -----------------------

    function queueReadyRecallThought(): Thought | null {
      const recallThought = takeReadyRecallThought(recallThoughtTask);
      if (!recallThought) return null;
      thoughtsAcc.push(recallThought);
      return recallThought;
    }

    // ---- Generation ---------------------------------------------------------

    let resultPayload: GenerateAndValidateResult | undefined;

    if (deps.generationGraphDeps) {
      // Use the generation subgraph for LangSmith trace visibility.
      // The subgraph pushes orchestration events to a shared array as each
      // async generator produces them. We poll the array below so events are
      // forwarded to the frontend as they happen — same streaming behavior as
      // the existing adapter path — instead of buffering until invoke completes.
      const { createGenerationSubgraph } = await import("./roleplayGenerationSubgraph");
      const { graph: genGraph, sharedEvents } = createGenerationSubgraph(deps.generationGraphDeps);

      const graphPromise = genGraph.invoke({
        sessionId,
        userMessage,
        session,
        characterContext,
        promptContext,
        draft: undefined, validation1Result: undefined, rewriteDraft: undefined,
        validation2Result: undefined, generationResult: undefined, errors: undefined,
        resolvedContext: context,
        _cache: thoughtSummaryCache,
        _thoughtsAcc: thoughtsAcc,
        _signal: signal,
        _isFirstUserTurn: context.isFirstUserTurn,
        _voiceHints: voiceHints,
      } as any);

      // Track graph completion non-blockingly so we can poll sharedEvents
      let graphDone = false;
      let graphError: Error | undefined;
      let genState: any;

      graphPromise.then(
        (s) => { genState = s; graphDone = true; },
        (e) => { graphError = e as Error; graphDone = true; },
      );

      // Poll sharedEvents and yield events as they arrive, interleaving any
      // ready recall thoughts — matching runRoleplayGenerationAdapter behavior.
      let pollIdx = 0;
      while (true) {
        while (pollIdx < sharedEvents.length) {
          const ev = sharedEvents[pollIdx++];

          // Queue any ready recall thought before each generated event
          const recallThought = queueReadyRecallThought();
          if (recallThought) {
            yield { event: "thought", data: recallThought };
          }

          if (ev.type === "thought") {
            yield { event: "thought" as const, data: ev.thought };
          } else if (ev.type === "tool_call") {
            yield { event: "tool_call" as const, data: { id: ev.id, name: ev.name, args: ev.args } };
          } else if (ev.type === "tool_result") {
            yield { event: "tool_result" as const, data: { id: ev.id, name: ev.name, summary: ev.summary } };
          }
          // delta events are only produced by the higher-level
          // generateAndValidateStream, not by individual generation helpers, so
          // they won't appear here. If they did, they would be suppressed
          // (same as the existing adapter path).
        }
        if (graphDone) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      if (graphError) throw graphError;

      // Check for unhandled errors from the generation subgraph.
      // When errorSink is reached (non-tool-loop errors), errors exist but
      // generationResult does not — yield an error event and skip persistence.
      if (genState.errors && genState.errors.length > 0 && !genState.generationResult) {
        const errMsg = genState.errors.map((e: any) => `[${e.stage}] ${e.message}`).join("; ");
        yield { event: "error", data: { message: errMsg } };
        return;
      }

      if (genState.generationResult) {
        resultPayload = genState.generationResult as GenerateAndValidateResult;
      }
    } else {
      for await (const ev of deps.runGeneration({
        promptContext,
        userMessage,
        session,
        personaOverlay,
        signal,
        thoughtSummaryCache,
        thoughtsAcc,
        isFirstUserTurn: context.isFirstUserTurn,
        takeReadyRecallThought: queueReadyRecallThought,
      })) {
        if (ev.event === "_complete") {
          resultPayload = ev.data;
        } else {
          yield ev;
        }
      }
    }

    // ---- Abort / no-complete check -----------------------------------------

    if (signal?.aborted || !resultPayload) {
      return;
    }

    // ---- Final recall wait --------------------------------------------------

    const result = resultPayload;
    const finalRecallThought = await waitForRecallThought(recallThoughtTask);
    if (finalRecallThought.timedOut) {
      recallTraceState.timedOutBeforeFinalReplay = true;
    }
    if (finalRecallThought.thought) {
      thoughtsAcc.push(finalRecallThought.thought);
      yield { event: "thought", data: finalRecallThought.thought };
    }

    // ---- Persistence --------------------------------------------------------

    const { persistedRoute, persisted } = await deps.persistTurn({
      session,
      userMessage,
      generationResult: result,
      derivedState: context.derivedState,
      memories: context.memories ?? [],
      thoughts: thoughtsAcc,
      generationModelBinding: deps.generationModelBinding,
      finalRecallTimedOut: finalRecallThought.timedOut,
      persistLateRecallThought,
    });

    // ---- Final prose replay -------------------------------------------------

    for (let i = 0; i < result.content.length; i += FINAL_REPLY_REPLAY_SLICE) {
      yield {
        event: "delta",
        data: {
          text: result.content.slice(i, i + FINAL_REPLY_REPLAY_SLICE),
        },
      };
    }

    // ---- Done ---------------------------------------------------------------

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

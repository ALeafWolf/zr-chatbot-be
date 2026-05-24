import { describe, it } from "node:test";
import assert from "node:assert";
import {
  runRoleplayTurnStreamViaGraph,
  type RoleplayGraphStreamAdapterDeps,
} from "./roleplayGraphStreamAdapter";
import type { PreGenerationResult } from "./roleplayPreGenerationGraph";
import type { RoleplayGraphDeps } from "./roleplayGraph";
import type { RoleplayGenerationEvent } from "../roleplay/roleplayGenerationAdapter";
import type { PersistRoleplayTurnInput } from "../roleplay/roleplayPersistenceAdapter";
import type { CharacterTurnSseEvent } from "../turn/runCharacterTurn";
import type { ChatSession } from "../../db/schema/chat";
import type { Thought } from "../thought/thoughtTypes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) {
    items.push(item);
  }
  return items;
}

function noopTrace(): Promise<void> {
  return Promise.resolve();
}

async function noopUpdateThoughts(): Promise<void> {
  // no-op
}

async function defaultBuildRecallThought(input: {
  characterName: string;
  context: { selected: Array<{ source: string; text: string }> };
}): Promise<{ text: string }> {
  return { text: input.context.selected.map((s) => s.text).join("\n") };
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function fakeSession(overrides?: Partial<ChatSession>): ChatSession {
  return {
    sessionId: "sess_rp_test",
    characterId: "zuo_ran",
    playerId: "p-001",
    mode: "canonical_live",
    continuityScope: "main",
    continuityFamily: "main_world",
    personaOverlayId: null,
    memoryNamespace: "main",
    pinnedTime: null,
    pinnedLocation: null,
    writebackPolicy: "full_writeback",
    sessionSummary: null,
    displayTitle: null,
    thinking: true,
    temperature: 1,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const fakeModelBinding = {
  provider: "deepseek" as const,
  model: "deepseek-chat",
};

const fakeCharacterDefaults = {
  character_id: "zuo_ran",
  name: "Zuo Ran",
  identity: "A wandering scholar.",
  speech_style: {
    language: "Chinese",
    formality: "formal",
    emotionality: "restrained",
    preferred_patterns: [],
    avoid: [],
  },
  core_traits: ["wise"],
  hard_rules: ["Stay in character."],
  interaction_defaults: {
    default_continuity_scope: "main",
    default_emotional_baseline: "calm",
    default_relationship_baseline: "neutral",
    response_length: "medium",
    allows_personal_topics: "sometimes",
  },
  safe_deflection: "I am not sure.",
  version: "1.0",
};

function fakePreGenerationResult(
  overrides?: Partial<PreGenerationResult>,
): PreGenerationResult {
  return {
    session: fakeSession(),
    characterContext: {
      characterDefaults: fakeCharacterDefaults,
      overlayId: "main",
      personaOverlay: {
        overlay_id: "main",
        character_id: "zuo_ran",
        continuity_scope: "main",
        relationship_status: "confirmed_relationship",
      },
      voiceHints: "formal, restrained",
    },
    resolvedContext: {
      derivedState: {
        inferredMood: "calm",
        inferredActivity: "conversing",
        conversationalStance: "neutral",
      },
      memories: [],
      isFirstUserTurn: false,
      recallThoughtContext: {
        items: [],
        countsBySource: {},
        selectionMode: "fallback",
      },
    },
    promptContext: {
      systemPrompt: "[SYSTEM]\nYou are Zuo Ran.",
      conversationHistory: [],
    },
    errors: undefined,
    ...overrides,
  };
}

const fakeGenResultData = {
  content: "Test response for path parity.",
  validatorResult: {
    in_character: true, canon_consistent: true, session_state_consistent: true, nsfw_within_bounds: true, issues: [], needs_rewrite: false,
  },
  wasRewritten: false,
  wasDeflected: false,
  inputTokens: 100,
  outputTokens: 50,
};

const fakePersistOutput = {
  persistedRoute: "roleplay_turn" as const,
  persisted: {
    userMessageId: "um-001",
    assistantMessageId: "am-001",
    assistantTurnIndex: 5,
    jobId: null as string | null,
  },
};

// ---------------------------------------------------------------------------
// Default fake deps factory
// ---------------------------------------------------------------------------

function fakePreGenerationDeps(): RoleplayGraphDeps {
  return {
    loadSession: async () => fakeSession(),
    loadCharacterContext: async () => ({}) as any,
    resolveContext: async () => ({}) as any,
    buildPromptContext: async () => ({}) as any,
    runGeneration: async function* () {
      // no-op
    },
    persistTurn: async () => ({}) as any,
    generationModelBinding: fakeModelBinding,
  };
}

function makeCompleteGeneration(
  content = "Default response.",
): () => AsyncGenerator<RoleplayGenerationEvent> {
  return async function* () {
    yield {
      event: "_complete",
      data: {
        content,
        validatorResult: {
          in_character: true,
          canon_consistent: true,
          session_state_consistent: true,
          nsfw_within_bounds: true,
          issues: [],
          needs_rewrite: false,
        },
        wasRewritten: false,
        wasDeflected: false,
        inputTokens: 100,
        outputTokens: 50,
      },
    };
  };
}

function makeAdapterDeps(
  overrides?: Partial<RoleplayGraphStreamAdapterDeps>,
): RoleplayGraphStreamAdapterDeps {
  return {
    runPreGeneration: async () => fakePreGenerationResult(),
    preGenerationDeps: fakePreGenerationDeps(),
    runGeneration: makeCompleteGeneration("Hello, this is a test response."),
    persistTurn: async () => fakePersistOutput,
    generationModelBinding: fakeModelBinding,
    buildRecallThought: defaultBuildRecallThought,
    updateThoughts: noopUpdateThoughts,
    traceRoleplayTurn: noopTrace,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("roleplayGraphStreamAdapter", () => {
  it("produces delta and done events for a normal complete turn", async () => {
    const responseContent = "Hello, this is a test response.";
    const deps = makeAdapterDeps({
      runGeneration: makeCompleteGeneration(responseContent),
    });

    const events = await collect(
      runRoleplayTurnStreamViaGraph(
        {
          sessionId: "sess_rp_test",
          userMessage: "hello",
          session: fakeSession(),
        },
        deps,
      ),
    );

    // Delta events (sliced by FINAL_REPLY_REPLAY_SLICE = 96)
    const deltas = events.filter(
      (e): e is { event: "delta"; data: { text: string } } =>
        e.event === "delta",
    );
    assert.ok(deltas.length > 0, "should have delta events");
    const allDeltaText = deltas.map((d) => d.data.text).join("");
    assert.strictEqual(allDeltaText, responseContent);

    // Final done event
    const doneEvent = events.find((e) => e.event === "done") as
      | { event: "done"; data: Record<string, unknown> }
      | undefined;
    assert.ok(doneEvent, "should emit done");
    assert.strictEqual(doneEvent.data.message_id, "am-001");
    assert.strictEqual(doneEvent.data.content, responseContent);
    assert.strictEqual(doneEvent.data.turn_index, 5);
    assert.strictEqual(doneEvent.data.route, "roleplay_turn");

    // No error events
    assert.strictEqual(
      events.find((e) => e.event === "error"),
      undefined,
      "should not emit error",
    );
  });

  it("uses the session loaded by the pre-generation graph", async () => {
    const graphSession = fakeSession({ sessionId: "sess_graph_loaded" });
    let usedSession: ChatSession | undefined;

    const deps = makeAdapterDeps({
      runPreGeneration: async () =>
        fakePreGenerationResult({ session: graphSession }),
      // PersistTurn captures the session it receives
      persistTurn: async (input: PersistRoleplayTurnInput) => {
        usedSession = input.session;
        return fakePersistOutput;
      },
      // Provide a _complete result so the flow reaches persistence
      runGeneration: makeCompleteGeneration("Session check."),
    });

    await collect(
      runRoleplayTurnStreamViaGraph(
        {
          sessionId: "sess_callers_session",
          userMessage: "hello",
          session: fakeSession({ sessionId: "sess_callers_session" }),
        },
        deps,
      ),
    );

    assert.ok(usedSession, "persistTurn should have been called");
    assert.strictEqual(
      usedSession!.sessionId,
      "sess_graph_loaded",
      "should use graph-loaded session, not caller-supplied session",
    );
  });

  it("preserves thought and tool event order around generation", async () => {
    const deps = makeAdapterDeps({
      runGeneration: async function* () {
        yield {
          event: "thought",
          data: { kind: "drafting", text: "thinking...", ts: 1 },
        };
        yield {
          event: "tool_call",
          data: { id: "tc-1", name: "search", args: { q: "test" } },
        };
        yield {
          event: "tool_result",
          data: { id: "tc-1", name: "search", summary: "found 0 results" },
        };
        yield {
          event: "_complete",
          data: {
            content: "Final answer.",
            validatorResult: {
              in_character: true,
              canon_consistent: true,
              session_state_consistent: true,
              nsfw_within_bounds: true,
              issues: [],
              needs_rewrite: false,
            },
            wasRewritten: false,
            wasDeflected: false,
            inputTokens: 100,
            outputTokens: 50,
          },
        };
      },
    });

    const events = await collect(
      runRoleplayTurnStreamViaGraph(
        { sessionId: "sess_rp_test", userMessage: "hello", session: fakeSession() },
        deps,
      ),
    );

    const thoughtIdx = events.findIndex(
      (e) => e.event === "thought" && (e.data as Thought).kind === "drafting",
    );
    const toolCallIdx = events.findIndex((e) => e.event === "tool_call");
    const toolResultIdx = events.findIndex((e) => e.event === "tool_result");

    assert.notStrictEqual(thoughtIdx, -1, "thought event must exist");
    assert.notStrictEqual(toolCallIdx, -1, "tool_call event must exist");
    assert.notStrictEqual(toolResultIdx, -1, "tool_result event must exist");

    assert.ok(
      thoughtIdx < toolCallIdx,
      "thought should appear before tool_call",
    );
    assert.ok(
      toolCallIdx < toolResultIdx,
      "tool_call should appear before tool_result",
    );

    const deltaIdx = events.findIndex((e) => e.event === "delta");
    const doneIdx = events.findIndex((e) => e.event === "done");
    assert.ok(deltaIdx > toolResultIdx, "delta should appear after tool_result");
    assert.ok(doneIdx > deltaIdx, "done should appear after delta");
  });

  it("yields ready recall thought before generation events", async () => {
    const deps = makeAdapterDeps({
      runPreGeneration: async () =>
        fakePreGenerationResult({
          resolvedContext: {
            derivedState: {
              inferredMood: "calm",
              inferredActivity: "conversing",
              conversationalStance: "neutral",
            },
            memories: [],
            isFirstUserTurn: false,
            recallThoughtContext: {
              items: [
                {
                  source: "memory",
                  text: "previous conversation context",
                },
              ],
              countsBySource: { memory: 1 },
              selectionMode: "rerank",
            },
          },
        }),
      buildRecallThought: async () => ({ text: "recall thought summary" }),
    });

    const events = await collect(
      runRoleplayTurnStreamViaGraph(
        { sessionId: "sess_rp_test", userMessage: "hello", session: fakeSession() },
        deps,
      ),
    );

    const firstThought = events.find(
      (e) => e.event === "thought",
    ) as { event: "thought"; data: Thought } | undefined;
    assert.ok(firstThought, "should have a thought event");
    assert.strictEqual(firstThought.data.kind, "recall");
    assert.strictEqual(firstThought.data.text, "recall thought summary");

    const doneEvent = events.find((e) => e.event === "done");
    assert.ok(doneEvent, "should complete with done");
  });

  it("returns without persistence when signal is aborted", async () => {
    const abortController = new AbortController();
    abortController.abort();

    let persistCalled = false;
    const deps = makeAdapterDeps({
      runGeneration: async function* () {
        // generation adapter checks signal and returns early
      },
      persistTurn: async () => {
        persistCalled = true;
        return fakePersistOutput;
      },
    });

    const events = await collect(
      runRoleplayTurnStreamViaGraph(
        {
          sessionId: "sess_rp_test",
          userMessage: "hello",
          session: fakeSession(),
          signal: abortController.signal,
        },
        deps,
      ),
    );

    assert.strictEqual(persistCalled, false, "persistTurn should not be called");
    assert.strictEqual(
      events.find((e) => e.event === "delta"),
      undefined,
      "no delta events on abort",
    );
    assert.strictEqual(
      events.find((e) => e.event === "done"),
      undefined,
      "no done event on abort",
    );
  });

  it("returns without persistence when generation yields no _complete", async () => {
    let persistCalled = false;
    const deps = makeAdapterDeps({
      runGeneration: async function* () {
        yield {
          event: "thought",
          data: { kind: "drafting", text: "hmm", ts: 1 },
        };
        // No _complete yielded
      },
      persistTurn: async () => {
        persistCalled = true;
        return fakePersistOutput;
      },
    });

    const events = await collect(
      runRoleplayTurnStreamViaGraph(
        { sessionId: "sess_rp_test", userMessage: "hello", session: fakeSession() },
        deps,
      ),
    );

    assert.strictEqual(
      persistCalled,
      false,
      "persistTurn should not be called when no _complete",
    );
    assert.strictEqual(
      events.find((e) => e.event === "delta"),
      undefined,
      "no delta events without _complete",
    );
    assert.strictEqual(
      events.find((e) => e.event === "done"),
      undefined,
      "no done event without _complete",
    );
  });

  it("passes finalRecallTimedOut when recall thought does not settle in time", async () => {
    let persistInput: PersistRoleplayTurnInput | undefined;

    const deps = makeAdapterDeps({
      runPreGeneration: async () =>
        fakePreGenerationResult({
          resolvedContext: {
            derivedState: {
              inferredMood: "calm",
              inferredActivity: "conversing",
              conversationalStance: "neutral",
            },
            memories: [],
            isFirstUserTurn: false,
            recallThoughtContext: {
              items: [
                { source: "memory", text: "something to recall" },
              ],
              countsBySource: { memory: 1 },
              selectionMode: "rerank",
            },
          },
        }),
      buildRecallThought: async () => {
        // Never settles within the 150ms final recall timeout
        await new Promise(() => {}); // never resolves
        return { text: "too late" };
      },
      persistTurn: async (input: PersistRoleplayTurnInput) => {
        persistInput = input;
        return fakePersistOutput;
      },
    });

    const events = await collect(
      runRoleplayTurnStreamViaGraph(
        { sessionId: "sess_rp_test", userMessage: "hello", session: fakeSession() },
        deps,
      ),
    );

    assert.ok(persistInput, "persistTurn should have been called");
    assert.strictEqual(
      persistInput!.finalRecallTimedOut,
      true,
      "finalRecallTimedOut should be true",
    );
    assert.strictEqual(
      persistInput!.thoughts.length,
      0,
      "no recall thoughts should be in accumulator",
    );

    assert.ok(
      events.find((e) => e.event === "delta"),
      "delta should be emitted",
    );
    assert.ok(
      events.find((e) => e.event === "done"),
      "done should be emitted",
    );
  });

  it("yields error event when pre-generation errors and stops", async () => {
    let generationCalled = false;
    let persistCalled = false;

    const deps = makeAdapterDeps({
      runPreGeneration: async () =>
        fakePreGenerationResult({
          session: undefined,
          characterContext: undefined,
          resolvedContext: undefined,
          promptContext: undefined,
          errors: [{ stage: "loadSession", message: "Session not found" }],
        }),
      runGeneration: async function* () {
        generationCalled = true;
      },
      persistTurn: async () => {
        persistCalled = true;
        return fakePersistOutput;
      },
    });

    const events = await collect(
      runRoleplayTurnStreamViaGraph(
        { sessionId: "sess_bad", userMessage: "hello", session: fakeSession() },
        deps,
      ),
    );

    assert.strictEqual(events.length, 1);
    const errorEvent = events[0] as {
      event: "error";
      data: { message: string };
    };
    assert.strictEqual(errorEvent.event, "error");
    assert.match(errorEvent.data.message, /Session not found/);

    assert.strictEqual(generationCalled, false);
    assert.strictEqual(persistCalled, false);
  });

  it("yields error event when pre-generation returns missing session", async () => {
    let persistCalled = false;

    const deps = makeAdapterDeps({
      runPreGeneration: async () =>
        fakePreGenerationResult({
          session: undefined,
        }),
      runGeneration: async function* () {
        // should not be reached
      },
      persistTurn: async () => {
        persistCalled = true;
        return fakePersistOutput;
      },
    });

    const events = await collect(
      runRoleplayTurnStreamViaGraph(
        { sessionId: "sess_rp_test", userMessage: "hello", session: fakeSession() },
        deps,
      ),
    );

    assert.strictEqual(events.length, 1);
    const errorEvent = events[0] as {
      event: "error";
      data: { message: string };
    };
    assert.strictEqual(errorEvent.event, "error");
    assert.match(
      errorEvent.data.message,
      /failed to load session/,
    );
    assert.strictEqual(persistCalled, false);
  });

  it("yields error event when pre-generation returns missing context", async () => {
    let persistCalled = false;

    const deps = makeAdapterDeps({
      runPreGeneration: async () =>
        fakePreGenerationResult({
          characterContext: undefined,
          resolvedContext: undefined,
          promptContext: undefined,
        }),
      runGeneration: async function* () {
        yield {
          event: "_complete",
          data: {
            content: "should not run",
            validatorResult: {
              in_character: true,
              canon_consistent: true,
              session_state_consistent: true,
              nsfw_within_bounds: true,
              issues: [],
              needs_rewrite: false,
            },
            wasRewritten: false,
            wasDeflected: false,
            inputTokens: 0,
            outputTokens: 0,
          },
        };
      },
      persistTurn: async () => {
        persistCalled = true;
        return fakePersistOutput;
      },
    });

    const events = await collect(
      runRoleplayTurnStreamViaGraph(
        { sessionId: "sess_rp_test", userMessage: "hello", session: fakeSession() },
        deps,
      ),
    );

    assert.strictEqual(events.length, 1);
    const errorEvent = events[0] as {
      event: "error";
      data: { message: string };
    };
    assert.strictEqual(errorEvent.event, "error");
    assert.match(
      errorEvent.data.message,
      /failed to produce required context/,
    );
    assert.strictEqual(persistCalled, false);
  });

  it("preserves thought/tool events and persistence through generationGraphDeps path", async () => {
    let persistCalled = false;
    let persistInput: PersistRoleplayTurnInput | undefined;
    const responseContent = "Hello from gen graph.";

    const deps = makeAdapterDeps({
      generationGraphDeps: {
        loadSession: async () => fakeSession(),
        loadCharacterContext: async () => ({}) as any,
        resolveContext: async () => ({}) as any,
        buildPromptContext: async () => ({}) as any,
        runGeneration: async function* () {},
        persistTurn: async () => ({}) as any,
        generationModelBinding: { provider: "deepseek" as const, model: "deepseek-chat" },
        generateDraftFn: async function* () {
          yield { type: "thought" as const, thought: { kind: "drafting" as const, text: "thinking...", ts: 1 } as Thought };
          yield { type: "tool_call" as const, id: "tc-1", name: "search", args: { q: "test" } };
          yield { type: "tool_result" as const, id: "tc-1", name: "search", summary: "found 0" };
          return { content: responseContent, inputTokens: 100, outputTokens: 50 };
        } as any,
        validateDraftFn: async () => ({ in_character: true, canon_consistent: true, session_state_consistent: true, nsfw_within_bounds: true, issues: [], needs_rewrite: false }),
        rewriteDraftFn: async function* () { return { content: "", inputTokens: 0, outputTokens: 0 }; } as any,
        safeDeflectionFn: async function* () { return { content: "", wasDeflected: true, wasRewritten: false, inputTokens: 0, outputTokens: 0, validatorResult: {} } as any; } as any,
      } as any,
      persistTurn: async (input: PersistRoleplayTurnInput) => {
        persistCalled = true;
        persistInput = input;
        return fakePersistOutput;
      },
      buildRecallThought: async () => ({ text: "" }),
    });

    const events = await collect(
      runRoleplayTurnStreamViaGraph(
        { sessionId: "sess_rp_test", userMessage: "hello", session: fakeSession() },
        deps,
      ),
    );

    // Should have thought and tool_call/tool_result events
    const thoughtEvents = events.filter((e) => e.event === "thought");
    const toolCallEvents = events.filter((e) => e.event === "tool_call");
    const toolResultEvents = events.filter((e) => e.event === "tool_result");
    assert.ok(thoughtEvents.length > 0, "should have thought events from gen graph");
    assert.ok(toolCallEvents.length > 0, "should have tool_call event from gen graph");
    assert.ok(toolResultEvents.length > 0, "should have tool_result event from gen graph");

    // Should have delta and done
    const deltaEvents = events.filter((e) => e.event === "delta");
    assert.ok(deltaEvents.length > 0, "should have delta events from gen graph");

    const doneEvent = events.find((e) => e.event === "done") as any;
    assert.ok(doneEvent, "should have done event from gen graph");
    assert.strictEqual(doneEvent.data.content, responseContent);

    // Persistence should be called
    assert.ok(persistCalled, "persistTurn should be called");
    assert.ok(persistInput, "persistTurn should have input");

    // No error
    assert.strictEqual(events.find((e) => e.event === "error"), undefined);
  });

  it("interleaves ready recall thought before tool events on graph path", async () => {
    const deps = makeAdapterDeps({
      runPreGeneration: async () =>
        fakePreGenerationResult({
          resolvedContext: {
            derivedState: { inferredMood: "calm", inferredActivity: "conversing", conversationalStance: "neutral" },
            memories: [],
            isFirstUserTurn: false,
            recallThoughtContext: {
              items: [{ source: "memory", text: "previous conversation context" }],
              countsBySource: { memory: 1 },
              selectionMode: "rerank",
            },
          },
        }),
      buildRecallThought: async () => ({ text: "recall thought summary" }),
      generationGraphDeps: {
        loadSession: async () => fakeSession(),
        loadCharacterContext: async () => ({}) as any,
        resolveContext: async () => ({}) as any,
        buildPromptContext: async () => ({}) as any,
        runGeneration: async function* () {},
        persistTurn: async () => ({}) as any,
        generationModelBinding: { provider: "deepseek" as const, model: "deepseek-chat" },
        generateDraftFn: async function* () {
          // Yield a tool_call — the recall thought starts settling during the
          // async gap of genGraph.invoke, so it should be ready when the poll
          // loop discovers this event and calls queueReadyRecallThought.
          yield { type: "tool_call" as const, id: "tc-1", name: "search", args: { q: "test" } };
          yield { type: "tool_result" as const, id: "tc-1", name: "search", summary: "found 0" };
          return { content: "response", inputTokens: 100, outputTokens: 50 };
        } as any,
        validateDraftFn: async () => ({ in_character: true, canon_consistent: true, session_state_consistent: true, nsfw_within_bounds: true, issues: [], needs_rewrite: false }),
        rewriteDraftFn: async function* () { return { content: "", inputTokens: 0, outputTokens: 0 }; } as any,
        safeDeflectionFn: async function* () { return { content: "", wasDeflected: true, wasRewritten: false, inputTokens: 0, outputTokens: 0, validatorResult: {} } as any; } as any,
      } as any,
      persistTurn: async () => fakePersistOutput,
    });

    const events = await collect(
      runRoleplayTurnStreamViaGraph(
        { sessionId: "sess_rp_test", userMessage: "hello", session: fakeSession() },
        deps,
      ),
    );

    // Should have a recall thought before the first tool_call
    const recallThoughts = events.filter(
      (e) => e.event === "thought" && (e.data as Thought).kind === "recall",
    );
    assert.ok(recallThoughts.length > 0, "should have a recall thought on graph path");

    const firstRecallIdx = events.indexOf(recallThoughts[0]);
    const firstToolCallIdx = events.findIndex((e) => e.event === "tool_call");
    assert.ok(firstToolCallIdx >= 0, "should have a tool_call event");

    assert.ok(
      firstRecallIdx < firstToolCallIdx,
      "recall thought should appear before first tool_call on graph path",
    );
  });

  it("does not duplicate generator-pushed thoughts in done.thoughts on graph path", async () => {
    let persistInput: PersistRoleplayTurnInput | undefined;

    const deps = makeAdapterDeps({
      generationGraphDeps: {
        loadSession: async () => fakeSession(),
        loadCharacterContext: async () => ({}) as any,
        resolveContext: async () => ({}) as any,
        buildPromptContext: async () => ({}) as any,
        runGeneration: async function* () {},
        persistTurn: async () => ({}) as any,
        generationModelBinding: { provider: "deepseek" as const, model: "deepseek-chat" },
        generateDraftFn: async function* (input: any) {
          // Push to thoughtsAcc before yielding the thought event — just like
          // the real helpers do via emitThought(). If drainGenerator also pushes
          // the thought, it will appear twice in the final thoughtsAcc.
          const ta = input.thoughtsAcc as Thought[];
          ta.push({ kind: "drafting", text: "thinking...", ts: 1 });
          yield { type: "thought" as const, thought: { kind: "drafting" as const, text: "thinking...", ts: 1 } as Thought };
          return { content: "response", inputTokens: 100, outputTokens: 50 };
        } as any,
        validateDraftFn: async () => ({ in_character: true, canon_consistent: true, session_state_consistent: true, nsfw_within_bounds: true, issues: [], needs_rewrite: false }),
        rewriteDraftFn: async function* () { return { content: "", inputTokens: 0, outputTokens: 0 }; } as any,
        safeDeflectionFn: async function* () { return { content: "", wasDeflected: true, wasRewritten: false, inputTokens: 0, outputTokens: 0, validatorResult: {} } as any; } as any,
      } as any,
      persistTurn: async (input: PersistRoleplayTurnInput) => {
        persistInput = input;
        return fakePersistOutput;
      },
      buildRecallThought: async () => ({ text: "" }),
    });

    const events = await collect(
      runRoleplayTurnStreamViaGraph(
        { sessionId: "sess_rp_test", userMessage: "hello", session: fakeSession() },
        deps,
      ),
    );

    // Verify the thought event was yielded exactly once
    const draftingThoughtEvents = events.filter(
      (e) => e.event === "thought" && (e.data as Thought).kind === "drafting",
    );
    assert.strictEqual(
      draftingThoughtEvents.length, 1,
      "drafting thought event should be yielded exactly once",
    );

    // Verify the thought appears exactly once in done.thoughts
    const doneEvent = events.find((e) => e.event === "done") as any;
    assert.ok(doneEvent, "should have done event");
    const draftingThoughts = (doneEvent.data.thoughts as Thought[]).filter(
      (t) => t.kind === "drafting",
    );
    assert.strictEqual(
      draftingThoughts.length, 1,
      "drafting thought should appear exactly once in done.thoughts",
    );

    // Same check on persisted thoughts
    assert.ok(persistInput, "persistTurn should have input");
    const persistedDrafting = (persistInput!.thoughts as Thought[]).filter(
      (t) => t.kind === "drafting",
    );
    assert.strictEqual(
      persistedDrafting.length, 1,
      "drafting thought should appear exactly once in persisted thoughts",
    );
  });

  it("yields error event and does not persist on non-tool-loop generateDraftFn failure in graph path", async () => {
    let persistCalled = false;

    const deps = makeAdapterDeps({
      generationGraphDeps: {
        loadSession: async () => fakeSession(),
        loadCharacterContext: async () => ({}) as any,
        resolveContext: async () => ({}) as any,
        buildPromptContext: async () => ({}) as any,
        runGeneration: async function* () {},
        persistTurn: async () => ({}) as any,
        generationModelBinding: { provider: "deepseek" as const, model: "deepseek-chat" },
        generateDraftFn: async function* () {
          throw new Error("LLM call failed");
        } as any,
        validateDraftFn: async () => ({ in_character: true, canon_consistent: true, session_state_consistent: true, nsfw_within_bounds: true, issues: [], needs_rewrite: false }),
        rewriteDraftFn: async function* () { return { content: "", inputTokens: 0, outputTokens: 0 }; } as any,
        safeDeflectionFn: async function* () { return { content: "", wasDeflected: true, wasRewritten: false, inputTokens: 0, outputTokens: 0, validatorResult: {} } as any; } as any,
      } as any,
      persistTurn: async () => {
        persistCalled = true;
        return fakePersistOutput;
      },
      buildRecallThought: async () => ({ text: "" }),
    });

    const events = await collect(
      runRoleplayTurnStreamViaGraph(
        { sessionId: "sess_rp_test", userMessage: "hello", session: fakeSession() },
        deps,
      ),
    );

    assert.strictEqual(events.length, 1, "should emit exactly one event (error)");
    assert.strictEqual((events[0] as any).event, "error", "should emit error event");
    assert.match(
      (events[0] as any).data.message,
      /failed before completion/,
      "error message should be safe/generic, not raw error details",
    );
    assert.strictEqual(persistCalled, false, "persistTurn should not be called");
  });

  it("yields error event and does not persist on validateDraftFn failure in graph path", async () => {
    let persistCalled = false;

    const deps = makeAdapterDeps({
      generationGraphDeps: {
        loadSession: async () => fakeSession(),
        loadCharacterContext: async () => ({}) as any,
        resolveContext: async () => ({}) as any,
        buildPromptContext: async () => ({}) as any,
        runGeneration: async function* () {},
        persistTurn: async () => ({}) as any,
        generationModelBinding: { provider: "deepseek" as const, model: "deepseek-chat" },
        generateDraftFn: async function* () {
          return { content: "test draft", inputTokens: 100, outputTokens: 50 };
        } as any,
        validateDraftFn: async () => {
          throw new Error("Validator API error");
        },
        rewriteDraftFn: async function* () { return { content: "", inputTokens: 0, outputTokens: 0 }; } as any,
        safeDeflectionFn: async function* () { return { content: "", wasDeflected: true, wasRewritten: false, inputTokens: 0, outputTokens: 0, validatorResult: {} } as any; } as any,
      } as any,
      persistTurn: async () => {
        persistCalled = true;
        return fakePersistOutput;
      },
      buildRecallThought: async () => ({ text: "" }),
    });

    const events = await collect(
      runRoleplayTurnStreamViaGraph(
        { sessionId: "sess_rp_test", userMessage: "hello", session: fakeSession() },
        deps,
      ),
    );

    assert.strictEqual(events.length, 1, "should emit exactly one event (error)");
    assert.strictEqual((events[0] as any).event, "error", "should emit error event");
    assert.match(
      (events[0] as any).data.message,
      /failed before completion/,
      "error message should be safe/generic, not raw error details",
    );
    assert.strictEqual(persistCalled, false, "persistTurn should not be called");
  });

  // ---------------------------------------------------------------------------
  // Path parity tests
  // ---------------------------------------------------------------------------

  // Helper: minimal RoleplayGraphDeps for the generation subgraph path test
  function makeSubgraphDeps(): RoleplayGraphDeps {
    return {
      loadSession: async () => ({}) as any,
      loadCharacterContext: async () => ({}) as any,
      resolveContext: async () => ({}) as any,
      buildPromptContext: async () => ({}) as any,
      runGeneration: async function* () {},
      persistTurn: async () => ({}) as any,
      generationModelBinding: { provider: "deepseek" as const, model: "deepseek-chat" },
      generateDraftFn: async function* () {
        return { content: "Graph generated response.", inputTokens: 100, outputTokens: 50 };
      } as any,
      validateDraftFn: async () => ({ in_character: true, canon_consistent: true, session_state_consistent: true, nsfw_within_bounds: true, issues: [], needs_rewrite: false }),
      rewriteDraftFn: async function* () { return { content: "", inputTokens: 0, outputTokens: 0 }; } as any,
      safeDeflectionFn: async function* () { return { content: "", wasDeflected: true, wasRewritten: false, inputTokens: 0, outputTokens: 0, validatorResult: {} } as any; } as any,
    };
  }

  it("3-path parity: direct generation path produces delta+done events", async () => {
    const deps = makeAdapterDeps({
      runGeneration: async function* () {
        yield { event: "thought" as const, data: { kind: "recall" as const, text: "recall", ts: Date.now() } };
        yield { event: "tool_call" as const, data: { id: "t1", name: "test_tool", args: {} } };
        yield { event: "tool_result" as const, data: { id: "t1", name: "test_tool", summary: "done" } };
        yield { event: "_complete" as const, data: fakeGenResultData };
      },
    });

    const events = await collect(
      runRoleplayTurnStreamViaGraph(
        { sessionId: "sess_rp_test", userMessage: "hello", session: fakeSession() },
        deps,
      ),
    );

    assert.ok(events.length > 1, "direct path should produce multiple events");
    const thoughtEvents = events.filter((e) => e.event === "thought");
    assert.ok(thoughtEvents.length >= 1, "direct path should emit at least one thought event");
    const doneEvent = events.find((e) => e.event === "done");
    assert.ok(doneEvent, "direct path should emit a done event");
    const deltaEvents = events.filter((e) => e.event === "delta");
    assert.ok(deltaEvents.length > 0, "direct path should emit delta events");
  });

  it("3-path parity: graph pre-generation + direct generation path produces delta+done events", async () => {
    const deps = makeAdapterDeps({
      generationGraphDeps: undefined,
      runGeneration: async function* () {
        yield { event: "_complete" as const, data: fakeGenResultData };
      },
    });

    const events = await collect(
      runRoleplayTurnStreamViaGraph(
        { sessionId: "sess_rp_test", userMessage: "hello", session: fakeSession() },
        deps,
      ),
    );

    const deltaEvents = events.filter((e) => e.event === "delta");
    assert.ok(deltaEvents.length > 0, "pre-gen+direct path should emit delta events");
    const doneEvent = events.find((e) => e.event === "done");
    assert.ok(doneEvent, "pre-gen+direct path should emit a done event");
  });

  it("3-path parity: graph pre-generation + generation subgraph path produces delta+done events", async () => {
    const deps = makeAdapterDeps({
      generationGraphDeps: makeSubgraphDeps(),
    });

    const events = await collect(
      runRoleplayTurnStreamViaGraph(
        { sessionId: "sess_rp_test", userMessage: "hello", session: fakeSession() },
        deps,
      ),
    );

    const deltaEvents = events.filter((e) => e.event === "delta");
    assert.ok(deltaEvents.length > 0, "pre-gen+subgraph path should emit delta events");
    const doneEvent = events.find((e) => e.event === "done");
    assert.ok(doneEvent, "pre-gen+subgraph path should emit a done event");
  });
});

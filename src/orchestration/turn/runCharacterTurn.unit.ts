import { describe, it } from "node:test";
import assert from "node:assert";
import { env, parseEnabledFlag } from "../../config/env";
import { createRoleplayStreamFn } from "./runCharacterTurn";
import { createRoleplayGraph } from "../graphs/roleplayGraph";
import type { RoleplayGraphStreamAdapterDeps } from "../graphs/roleplayGraphStreamAdapter";
import type { PreGenerationResult } from "../graphs/roleplayPreGenerationGraph";
import type { CharacterTurnSseEvent } from "./runCharacterTurn";
import type { ChatSession } from "../../db/schema/chat";

// ---------------------------------------------------------------------------
// Env flag parsing tests
// ---------------------------------------------------------------------------

describe("ROLEPLAY_GRAPH_STREAM_ENABLED env parsing", () => {
  it("defaults to false when unset", () => {
    assert.strictEqual(parseEnabledFlag(undefined), false);
  });

  it("accepts 'true'", () => {
    assert.strictEqual(parseEnabledFlag("true"), true);
  });

  it("accepts '1'", () => {
    assert.strictEqual(parseEnabledFlag("1"), true);
  });

  it("treats 'false' as false", () => {
    assert.strictEqual(parseEnabledFlag("false"), false);
  });

  it("treats '0' as false", () => {
    assert.strictEqual(parseEnabledFlag("0"), false);
  });

  it("treats empty string as false", () => {
    assert.strictEqual(parseEnabledFlag(""), false);
  });

  it("is false at runtime in the test environment", () => {
    assert.strictEqual(env.ROLEPLAY_GRAPH_STREAM_ENABLED, false);
  });
});

// ---------------------------------------------------------------------------
// Selector tests
// ---------------------------------------------------------------------------

function fakeSession(): ChatSession {
  return {
    sessionId: "sess_test",
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
  };
}

function fakePreGenerationResult(): PreGenerationResult {
  return {
    session: fakeSession(),
    characterContext: {
      characterDefaults: {
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
      },
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
  };
}

const minimalFakeDeps: RoleplayGraphStreamAdapterDeps = {
  runPreGeneration: async () => fakePreGenerationResult(),
  preGenerationDeps: {} as any,
  runGeneration: async function* () {
    // no events -- generation completes without _complete
  },
  persistTurn: async () => ({
    persistedRoute: "roleplay_turn" as const,
    persisted: {
      userMessageId: "um-001",
      assistantMessageId: "am-001",
      assistantTurnIndex: 5,
      jobId: null as string | null,
    },
  }),
  generationModelBinding: {
    provider: "deepseek" as const,
    model: "deepseek-chat",
  },
  buildRecallThought: async () => ({ text: "" }),
  updateThoughts: async () => {},
  traceRoleplayTurn: async () => {},
};

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) {
    items.push(item);
  }
  return items;
}

describe("createRoleplayStreamFn", () => {
  it("routes through the graph adapter when flag is true", async () => {
    let preGenCalled = false;

    const deps: RoleplayGraphStreamAdapterDeps = {
      ...minimalFakeDeps,
      runPreGeneration: async (input, deps) => {
        preGenCalled = true;
        return fakePreGenerationResult();
      },
    };

    const streamFn = createRoleplayStreamFn(true, deps);
    const events = await collect(
      streamFn({
        sessionId: "sess_test",
        userMessage: "hello",
        session: fakeSession(),
      }),
    );

    assert.ok(preGenCalled, "pre-generation should be invoked by the graph adapter");
    // Stream returns without delta/done because runGeneration yields no _complete
    assert.strictEqual(events.length, 0);
  });

  it("uses the existing stream path when flag is false", async () => {
    let existingPathCalled = false;
    let graphPathCalled = false;

    const fakeExistingStream = async function* (): AsyncGenerator<CharacterTurnSseEvent> {
      existingPathCalled = true;
    };

    const deps: RoleplayGraphStreamAdapterDeps = {
      ...minimalFakeDeps,
      runPreGeneration: async () => {
        graphPathCalled = true;
        return fakePreGenerationResult();
      },
    };

    const streamFn = createRoleplayStreamFn(false, deps, fakeExistingStream);
    await collect(
      streamFn({
        sessionId: "sess_test",
        userMessage: "hello",
        session: fakeSession(),
      }),
    );

    assert.ok(
      existingPathCalled,
      "existing stream path should be called when flag is false",
    );
    assert.strictEqual(
      graphPathCalled,
      false,
      "graph adapter should NOT be called when flag is false",
    );
  });

  it("production graph stream path is pre-generation/adapter based, NOT createRoleplayGraph()", async () => {
    let preGenCalled = false;

    const deps: RoleplayGraphStreamAdapterDeps = {
      ...minimalFakeDeps,
      runPreGeneration: async (input, deps) => {
        preGenCalled = true;
        return fakePreGenerationResult();
      },
    };

    const streamFn = createRoleplayStreamFn(true, deps);
    await collect(
      streamFn({
        sessionId: "sess_test",
        userMessage: "hello",
        session: fakeSession(),
      }),
    );

    assert.ok(
      preGenCalled,
      "production graph stream must invoke runPreGeneration (adapter based), NOT createRoleplayGraph()",
    );
    // createRoleplayGraph is dev/smoke-only — verify the runtime marker exists
    assert.ok(
      (createRoleplayGraph as any).__devSmokeOnly,
      "createRoleplayGraph must be tagged as dev/smoke-only, not used by production stream",
    );
  });
});

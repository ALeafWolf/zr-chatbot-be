import { describe, it } from "node:test";
import assert from "node:assert";
import { createRoleplayGraph, type RoleplayGraphDeps } from "./roleplayGraph";
import type { ChatSession } from "../../db/schema/chat";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function fakeSession(): ChatSession {
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
  };
}

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

const fakeCharacterContext = {
  characterDefaults: fakeCharacterDefaults,
  overlayId: "main",
  personaOverlay: {
    overlay_id: "main",
    character_id: "zuo_ran",
    continuity_scope: "main",
    relationship_status: "confirmed_relationship",
  },
  voiceHints: "formal，restrained",
};

const fakeResolvedContext = {
  derivedState: {
    inferredMood: "calm",
    inferredActivity: "conversing",
    conversationalStance: "neutral",
  },
  memories: [],
  canonChunks: [],
  canonScenes: [],
  recentTurns: [],
  queryEmbedding: [0.1, 0.2],
  canonQueryEmbedding: [0.1, 0.2],
  sessionSummary: null,
  sessionRecall: [],
  structMemEntries: [],
  structMemEntryContextExpansions: [],
  structMemConsolidations: [],
  openThreads: [],
  memoryCorrections: [],
  latestTurnDelta: null,
  queryRewrite: {
    intent: "general",
    confidence: 0.9,
    segments: [],
    combined_for_embedding: "chat",
    entities: [],
    parseOk: true,
    structuralParseOk: true,
    labelOk: true,
  },
  retrievalPlan: {
    intent: "general",
    canonMode: "skip",
    durableMemoryTopK: 8,
    sessionRecallTopK: 12,
    structMemEntryTopK: 16,
    structMemConsolidationTopK: 4,
    openThreadTopK: 4,
    broadFailOpen: false,
    forceOpenThreads: false,
    contextNeed: {
      needsRecentTurns: true,
      needsOlderSessionRecall: false,
      needsDurableMemory: false,
      needsStructMem: false,
      needsStructMemConsolidation: false,
      needsCanon: false,
      needsWeb: false,
      structMemReason: "none",
      injectionMode: "skip",
      reason: "casual",
    },
  },
  turnType: "general_roleplay",
  isFirstUserTurn: false,
  recallThoughtContext: { items: [], countsBySource: {}, selectionMode: "fallback" },
  rerankOutput: null,
  motifSignal: undefined,
  motifProbe: undefined,
};

const fakePromptContext = {
  systemPrompt: "[SYSTEM]\nYou are Zuo Ran.",
  conversationHistory: [],
};

const fakePersistResult = {
  persistedRoute: "roleplay_turn",
  persisted: {
    userMessageId: "um-001",
    assistantMessageId: "am-001",
    assistantTurnIndex: 5,
    jobId: null,
  },
};

// ---------------------------------------------------------------------------
// Default test deps (fakes, no DB/LLM)
// ---------------------------------------------------------------------------

function defaultTestDeps(
  overrides?: Partial<RoleplayGraphDeps>,
): RoleplayGraphDeps {
  return {
    loadSession: async () => fakeSession(),
    loadCharacterContext: async () => fakeCharacterContext as any,
    resolveContext: async () => fakeResolvedContext as any,
    buildPromptContext: async () => fakePromptContext as any,
    runGeneration: async function* () {
      yield {
        event: "_complete" as const,
        data: {
          content: "I am well.",
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
    persistTurn: async () => fakePersistResult as any,
    generationModelBinding: { provider: "deepseek", model: "deepseek-chat" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("roleplayGraph", () => {
  it("completes full graph progression with fakes", async () => {
    const graph = createRoleplayGraph(defaultTestDeps());
    const state = await graph.invoke({
      sessionId: "sess_rp_test",
      userMessage: "hello",
    });

    assert.ok(state.session, "session should be loaded");
    assert.ok(state.characterContext, "characterContext should be loaded");
    assert.ok(state.resolvedContext, "resolvedContext should be resolved");
    assert.ok(state.promptContext, "promptContext should be built");
    assert.ok(state.generationResult, "generationResult should be captured");
    assert.equal(
      (state.generationResult as any).content,
      "I am well.",
    );
    assert.equal(state.persistedRoute, "roleplay_turn");
    assert.ok(state.persisted);
  });

  it("captures loadSession errors with stage 'loadSession'", async () => {
    const deps = defaultTestDeps({
      loadSession: async () => {
        throw new Error("DB unavailable");
      },
    });

    const graph = createRoleplayGraph(deps);
    const state = await graph.invoke({
      sessionId: "sess_nonexistent",
      userMessage: "test",
    });

    assert.ok(state.errors);
    assert.strictEqual(state.errors.length, 1);
    assert.strictEqual(state.errors[0].stage, "loadSession");
    assert.strictEqual(state.errors[0].message, "DB unavailable");
    assert.strictEqual(state.session, undefined);
    assert.strictEqual(state.characterContext, undefined);
    assert.strictEqual(state.generationResult, undefined);
  });

  it("captures resolveContext errors with stage 'resolveContext'", async () => {
    const deps = defaultTestDeps({
      resolveContext: async () => {
        throw new Error("context resolution failed");
      },
    });

    const graph = createRoleplayGraph(deps);
    const state = await graph.invoke({
      sessionId: "sess_rp_test",
      userMessage: "test",
    });

    assert.ok(state.errors);
    assert.strictEqual(state.errors[0].stage, "resolveContext");
    assert.strictEqual(state.errors[0].message, "context resolution failed");
    // Prior nodes should still have produced output
    assert.ok(state.session);
    assert.ok(state.characterContext);
    // Downstream nodes should not have run
    assert.strictEqual(state.promptContext, undefined);
    assert.strictEqual(state.generationResult, undefined);
  });

  it("does not persist when generation does not complete", async () => {
    let persistCalled = false;
    const deps = defaultTestDeps({
      runGeneration: async function* () {
        // Yield a non-_complete event then end — no generation result.
        yield { event: "thought" as const, data: { kind: "drafting", text: "hmm", ts: 1 } };
      },
      persistTurn: async () => {
        persistCalled = true;
        return fakePersistResult as any;
      },
    });

    const graph = createRoleplayGraph(deps);
    const state = await graph.invoke({
      sessionId: "sess_rp_test",
      userMessage: "test",
    });

    assert.ok(state.generationEvents);
    assert.strictEqual(state.generationEvents.length, 1);
    assert.strictEqual(state.generationResult, undefined);
    assert.strictEqual(persistCalled, false);
    // Error should be recorded for generation not completing
    assert.ok(state.errors);
    assert.strictEqual(state.errors[0].stage, "generateAndValidate");
    assert.strictEqual(
      state.errors[0].message,
      "generation did not complete",
    );
  });

  it("accumulates non-_complete generation events for trace inspection", async () => {
    const deps = defaultTestDeps({
      runGeneration: async function* () {
        yield { event: "thought" as const, data: { kind: "drafting" as const, text: "thinking", ts: 1 } };
        yield { event: "_complete" as const, data: { content: "Final.", validatorResult: { in_character: true, canon_consistent: true, session_state_consistent: true, nsfw_within_bounds: true, issues: [], needs_rewrite: false }, wasRewritten: false, wasDeflected: false, inputTokens: 50, outputTokens: 25 } };
      },
    });

    const graph = createRoleplayGraph(deps);
    const state = await graph.invoke({
      sessionId: "sess_rp_test",
      userMessage: "test",
    });

    // Non-_complete events are collected for trace inspection
    assert.ok(state.generationEvents);
    assert.strictEqual(state.generationEvents.length, 1);
    assert.strictEqual(
      (state.generationEvents[0] as any).event,
      "thought",
    );
    // Generation result should still be captured
    assert.ok(state.generationResult);
    assert.strictEqual(
      (state.generationResult as any).content,
      "Final.",
    );
  });

  it("captures generateAndValidate errors from thrown exceptions", async () => {
    const deps = defaultTestDeps({
      runGeneration: async function* () {
        throw new Error("generation crash");
      },
    });

    const graph = createRoleplayGraph(deps);
    const state = await graph.invoke({
      sessionId: "sess_rp_test",
      userMessage: "test",
    });

    assert.ok(state.errors);
    assert.strictEqual(state.errors[0].stage, "generateAndValidate");
    assert.strictEqual(state.errors[0].message, "generation crash");
    assert.strictEqual(state.generationResult, undefined);
  });

  it("routes generation error to errorSink and does not persist", async () => {
    let persistCalled = false;

    // Simulate a scenario where the loadCharacterContext node returns an error
    const deps = defaultTestDeps({
      loadCharacterContext: async () => {
        throw new Error("character context unavailable");
      },
      persistTurn: async () => {
        persistCalled = true;
        return fakePersistResult as any;
      },
    });

    const graph = createRoleplayGraph(deps);
    const state = await graph.invoke({
      sessionId: "sess_rp_test",
      userMessage: "test",
    });

    // Graph should have completed via errorSink, not persistTurn
    assert.strictEqual(persistCalled, false);
    assert.strictEqual(state.persisted, undefined);

    // Error should be captured as characterContext error
    assert.ok(state.errors);
    assert.strictEqual(state.errors[0].stage, "loadCharacterContext");
  });
});

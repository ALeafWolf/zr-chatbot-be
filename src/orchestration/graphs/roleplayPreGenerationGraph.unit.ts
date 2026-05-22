import { describe, it } from "node:test";
import assert from "node:assert";
import {
  createRoleplayPreGenerationGraph,
  runRoleplayPreGenerationGraph,
} from "./roleplayPreGenerationGraph";
import type { RoleplayGraphDeps } from "./roleplayGraph";
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
  voiceHints: "formal, restrained",
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
  recallThoughtContext: {
    items: [],
    countsBySource: {},
    selectionMode: "fallback",
  },
  rerankOutput: null,
  motifSignal: undefined,
  motifProbe: undefined,
};

const fakePromptContext = {
  systemPrompt: "[SYSTEM]\nYou are Zuo Ran.",
  conversationHistory: [],
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
    persistTurn: async () => ({}) as any,
    generationModelBinding: {
      provider: "deepseek",
      model: "deepseek-chat",
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("roleplayPreGenerationGraph", () => {
  it("completes full pre-generation progression with fakes", async () => {
    const graph = createRoleplayPreGenerationGraph(defaultTestDeps());
    const state = await graph.invoke({
      sessionId: "sess_rp_test",
      userMessage: "hello",
    });

    assert.ok(state.session, "session should be loaded");
    assert.ok(
      state.characterContext,
      "characterContext should be loaded",
    );
    assert.ok(state.resolvedContext, "resolvedContext should be resolved");
    assert.ok(state.promptContext, "promptContext should be built");
    // No generation or persistence should have run
    assert.strictEqual(
      state.generationResult,
      undefined,
      "generationResult must not be set",
    );
    assert.strictEqual(
      state.persistedRoute,
      undefined,
      "persistedRoute must not be set",
    );
    assert.strictEqual(
      state.errors,
      undefined,
      "errors should be undefined on success",
    );
  });

  it("runRoleplayPreGenerationGraph returns context fields and no errors on success", async () => {
    const result = await runRoleplayPreGenerationGraph(
      { sessionId: "sess_rp_test", userMessage: "hello" },
      defaultTestDeps(),
    );

    assert.ok(result.session, "session should be returned");
    assert.ok(result.characterContext, "characterContext should be returned");
    assert.ok(result.resolvedContext, "resolvedContext should be returned");
    assert.ok(result.promptContext, "promptContext should be returned");
    assert.strictEqual(result.errors, undefined);
  });

  it("captures loadSession error and short-circuits", async () => {
    const deps = defaultTestDeps({
      loadSession: async () => {
        throw new Error("DB unavailable");
      },
    });

    const result = await runRoleplayPreGenerationGraph(
      { sessionId: "sess_nonexistent", userMessage: "test" },
      deps,
    );

    assert.ok(result.errors);
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(result.errors[0].stage, "loadSession");
    assert.strictEqual(result.errors[0].message, "DB unavailable");
    // Downstream fields must not be populated
    assert.strictEqual(result.session, undefined);
    assert.strictEqual(result.characterContext, undefined);
    assert.strictEqual(result.resolvedContext, undefined);
    assert.strictEqual(result.promptContext, undefined);
  });

  it("captures loadCharacterContext error and short-circuits", async () => {
    const deps = defaultTestDeps({
      loadCharacterContext: async () => {
        throw new Error("character context unavailable");
      },
    });

    const result = await runRoleplayPreGenerationGraph(
      { sessionId: "sess_rp_test", userMessage: "test" },
      deps,
    );

    assert.ok(result.session, "session should still be loaded");
    assert.ok(result.errors);
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(result.errors[0].stage, "loadCharacterContext");
    assert.strictEqual(
      result.errors[0].message,
      "character context unavailable",
    );
    // Downstream fields must not be populated
    assert.strictEqual(result.characterContext, undefined);
    assert.strictEqual(result.resolvedContext, undefined);
    assert.strictEqual(result.promptContext, undefined);
  });

  it("captures resolveContext error and short-circuits", async () => {
    const deps = defaultTestDeps({
      resolveContext: async () => {
        throw new Error("context resolution failed");
      },
    });

    const result = await runRoleplayPreGenerationGraph(
      { sessionId: "sess_rp_test", userMessage: "test" },
      deps,
    );

    assert.ok(result.session, "session should still be loaded");
    assert.ok(
      result.characterContext,
      "characterContext should still be loaded",
    );
    assert.ok(result.errors);
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(result.errors[0].stage, "resolveContext");
    assert.strictEqual(result.errors[0].message, "context resolution failed");
    // Downstream fields must not be populated
    assert.strictEqual(result.resolvedContext, undefined);
    assert.strictEqual(result.promptContext, undefined);
  });

  it("captures buildPrompt error and short-circuits", async () => {
    const deps = defaultTestDeps({
      buildPromptContext: async () => {
        throw new Error("prompt build failed");
      },
    });

    const result = await runRoleplayPreGenerationGraph(
      { sessionId: "sess_rp_test", userMessage: "test" },
      deps,
    );

    assert.ok(result.session, "session should still be loaded");
    assert.ok(
      result.characterContext,
      "characterContext should still be loaded",
    );
    assert.ok(result.resolvedContext, "resolvedContext should still be loaded");
    assert.ok(result.errors);
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(result.errors[0].stage, "buildPrompt");
    assert.strictEqual(result.errors[0].message, "prompt build failed");
    // BuildPrompt is the last node -- promptContext should still be undefined
    assert.strictEqual(result.promptContext, undefined);
  });
});

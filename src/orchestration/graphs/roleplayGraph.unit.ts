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

const fakePassValidation = {
  in_character: true, canon_consistent: true, session_state_consistent: true,
  nsfw_within_bounds: true, issues: [], needs_rewrite: false,
};

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
        data: { content: "I am well.", validatorResult: fakePassValidation, wasRewritten: false, wasDeflected: false, inputTokens: 100, outputTokens: 50 },
      };
    },
    persistTurn: async () => fakePersistResult as any,
    generationModelBinding: { provider: "deepseek", model: "deepseek-chat" },
    generateDraftFn: async function* () {
      return { content: "I am well.", inputTokens: 100, outputTokens: 50 };
    } as any,
    validateDraftFn: async () => fakePassValidation,
    rewriteDraftFn: async function* () {
      return { content: "Rewritten.", inputTokens: 50, outputTokens: 25 };
    } as any,
    safeDeflectionFn: async function* () {
      return { content: "I am not sure.", validatorResult: fakePassValidation, wasRewritten: false, wasDeflected: true, inputTokens: 0, outputTokens: 0 } as any;
    } as any,
    runLlmRerankFn: async () => ({ ok: true, rerankOutput: { selected: [] }, selectedContext: { memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], diagnostics: { retrievedCounts: { interactive_memory: 0, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 }, injectedCounts: { interactive_memory: 0, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 }, droppedDuplicateCount: 0, droppedLowScoreCount: 0, droppedCorrectionCount: 0, droppedBudgetCount: 0, topSources: [], averageInjectedScore: null } } as any, canonChunks: [], canonScenes: [], filteredSessionSummary: null, filteredLatestTurnDelta: null, filteredMemoryCorrections: [], rerankMs: 0 }) as any,
    deterministicSelectorFn: async () => ({ selectedContext: { memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], diagnostics: { retrievedCounts: { interactive_memory: 0, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 }, injectedCounts: { interactive_memory: 0, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 }, droppedDuplicateCount: 0, droppedLowScoreCount: 0, droppedCorrectionCount: 0, droppedBudgetCount: 0, topSources: [], averageInjectedScore: null } } as any, selectorFallbackMs: 0 }) as any,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("roleplayGraph", () => {
  it("completes full graph progression with fakes (generateDraft -> validateDraft -> buildResult -> persist)", async () => {
    const graph = createRoleplayGraph(defaultTestDeps());
    const state = await graph.invoke({
      sessionId: "sess_rp_test",
      userMessage: "hello",
    });

    assert.ok(state.session, "session should be loaded");
    assert.ok(state.characterContext, "characterContext should be loaded");
    assert.ok(state.resolvedContext, "resolvedContext should be resolved");
    assert.ok(state.promptContext, "promptContext should be built");
    assert.ok(state.draft, "draft should be captured from generateDraftNode");
    assert.ok(state.validation1Result, "validation1Result should be set");
    assert.ok(state.generationResult, "generationResult should be captured from buildGenerationResultNode");
    assert.equal((state.generationResult as any).content, "I am well.");
    assert.equal(state.persistedRoute, "roleplay_turn");
    assert.ok(state.persisted);
  });

  it("captures loadSession errors with stage 'loadSession'", async () => {
    const deps = defaultTestDeps({
      loadSession: async () => { throw new Error("DB unavailable"); },
    });

    const graph = createRoleplayGraph(deps);
    const state = await graph.invoke({ sessionId: "sess_nonexistent", userMessage: "test" });

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
      resolveContext: async () => { throw new Error("context resolution failed"); },
    });

    const graph = createRoleplayGraph(deps);
    const state = await graph.invoke({ sessionId: "sess_rp_test", userMessage: "test" });

    assert.ok(state.errors);
    assert.strictEqual(state.errors[0].stage, "resolveContext");
    assert.strictEqual(state.errors[0].message, "context resolution failed");
    assert.ok(state.session);
    assert.ok(state.characterContext);
    assert.strictEqual(state.promptContext, undefined);
    assert.strictEqual(state.generationResult, undefined);
  });

  it("captures generateDraft errors and routes through errorSink", async () => {
    let persistCalled = false;
    const deps = defaultTestDeps({
      generateDraftFn: async function* () {
        throw new Error("generation crash");
      } as any,
      persistTurn: async () => {
        persistCalled = true;
        return fakePersistResult as any;
      },
    });

    const graph = createRoleplayGraph(deps);
    const state = await graph.invoke({ sessionId: "sess_rp_test", userMessage: "test" });

    assert.ok(state.errors);
    assert.strictEqual(state.errors[0].stage, "generateDraft");
    assert.strictEqual(state.errors[0].message, "generation crash");
    assert.strictEqual(state.generationResult, undefined);
    assert.strictEqual(persistCalled, false);
  });

  it("routes characterContext error to errorSink and does not persist", async () => {
    let persistCalled = false;
    const deps = defaultTestDeps({
      loadCharacterContext: async () => { throw new Error("character context unavailable"); },
      persistTurn: async () => {
        persistCalled = true;
        return fakePersistResult as any;
      },
    });

    const graph = createRoleplayGraph(deps);
    const state = await graph.invoke({ sessionId: "sess_rp_test", userMessage: "test" });

    assert.strictEqual(persistCalled, false);
    assert.strictEqual(state.persisted, undefined);
    assert.ok(state.errors);
    assert.strictEqual(state.errors[0].stage, "loadCharacterContext");
  });

  it("draft tool loop deflection is persisted with correct reason", async () => {
    let capturedReason: string | undefined;
    let persistCalled = false;
    const deps = defaultTestDeps({
      generateDraftFn: async function* () {
        throw Object.assign(new Error("Tool loop budget exceeded"), { name: "ToolLoopExceededError" });
      } as any,
      safeDeflectionFn: async function* (input: any) {
        capturedReason = input.reason;
        return { content: "I am not sure.", validatorResult: fakePassValidation, wasRewritten: false, wasDeflected: true, inputTokens: 0, outputTokens: 0 } as any;
      } as any,
      persistTurn: async () => {
        persistCalled = true;
        return fakePersistResult as any;
      },
    });

    const state = await createRoleplayGraph(deps).invoke({ sessionId: "sess_rp_test", userMessage: "test" });
    assert.strictEqual(capturedReason, "tool_loop_exceeded");
    assert.ok(persistCalled, "persistTurn should be called after safe deflection");
    assert.ok(state.persisted, "state.persisted should be set");
    assert.strictEqual(state.persistedRoute, "roleplay_turn");
  });

  it("rewrite tool loop deflection is persisted with correct reason", async () => {
    let capturedReason: string | undefined;
    let persistCalled = false;
    const deps = defaultTestDeps({
      generateDraftFn: async function* () {
        return { content: "Draft.", inputTokens: 100, outputTokens: 50 };
      } as any,
      validateDraftFn: async () => ({ ...fakePassValidation, needs_rewrite: true, issues: ["character inconsistency: spoke out of character"] }),
      rewriteDraftFn: async function* () {
        throw Object.assign(new Error("Rewrite tool loop exceeded"), { name: "ToolLoopExceededError" });
      } as any,
      safeDeflectionFn: async function* (input: any) {
        capturedReason = input.reason;
        return { content: "I am not sure.", validatorResult: fakePassValidation, wasRewritten: true, wasDeflected: true, inputTokens: 100, outputTokens: 50 } as any;
      } as any,
      persistTurn: async () => {
        persistCalled = true;
        return fakePersistResult as any;
      },
    });

    const state = await createRoleplayGraph(deps).invoke({ sessionId: "sess_rp_test", userMessage: "test" });
    assert.strictEqual(capturedReason, "rewrite_tool_loop_exceeded");
    assert.ok(persistCalled, "persistTurn should be called after rewrite safe deflection");
    assert.ok(state.persisted, "state.persisted should be set");
    assert.strictEqual(state.persistedRoute, "roleplay_turn");
  });

  it("uses validator_hard_fail deflection reason for second validation failure", async () => {
    let capturedReason: string | undefined;
    const deps = defaultTestDeps({
      generateDraftFn: async function* () {
        return { content: "Draft.", inputTokens: 100, outputTokens: 50 };
      } as any,
      validateDraftFn: async (draft: string, input: any, attempt: number) => {
        if (attempt === 1) return { ...fakePassValidation, needs_rewrite: true, issues: ["character inconsistency: spoke out of character"] };
        return { ...fakePassValidation, needs_rewrite: true, issues: ["still out of character"] };
      },
      rewriteDraftFn: async function* () {
        return { content: "Rewrite.", inputTokens: 50, outputTokens: 25 };
      } as any,
      safeDeflectionFn: async function* (input: any) {
        capturedReason = input.reason;
        return { content: "I am not sure.", validatorResult: fakePassValidation, wasRewritten: true, wasDeflected: true, inputTokens: 150, outputTokens: 75 } as any;
      } as any,
    });

    await createRoleplayGraph(deps).invoke({ sessionId: "sess_rp_test", userMessage: "test" });
    assert.strictEqual(capturedReason, "validator_hard_fail");
  });

  it("normalizes meta-only validation failure on first pass", async () => {
    const deps = defaultTestDeps({
      generateDraftFn: async function* () {
        return { content: "Draft.", inputTokens: 100, outputTokens: 50 };
      } as any,
      validateDraftFn: async () => ({
        ...fakePassValidation,
        needs_rewrite: true,
        issues: ["json parse failure: could not parse output"],
      }),
    });

    const state = await createRoleplayGraph(deps).invoke({ sessionId: "sess_rp_test", userMessage: "test" });
    assert.ok(state.generationResult);
    assert.strictEqual((state.generationResult as any).validatorResult.needs_rewrite, false);
    assert.deepStrictEqual((state.generationResult as any).validatorResult.issues, []);
    assert.strictEqual((state.generationResult as any).wasRewritten, false);
  });

  it("normalizes meta-only validation failure on second pass", async () => {
    const deps = defaultTestDeps({
      generateDraftFn: async function* () {
        return { content: "Draft.", inputTokens: 100, outputTokens: 50 };
      } as any,
      validateDraftFn: async (draft: string, input: any, attempt: number) => {
        if (attempt === 1) return { ...fakePassValidation, needs_rewrite: true, issues: ["character inconsistency: spoke out of character"] };
        return { ...fakePassValidation, needs_rewrite: true, issues: ["validator system failure: schema mismatch"] };
      },
      rewriteDraftFn: async function* () {
        return { content: "Rewrite.", inputTokens: 50, outputTokens: 25 };
      } as any,
    });

    const state = await createRoleplayGraph(deps).invoke({ sessionId: "sess_rp_test", userMessage: "test" });
    assert.ok(state.generationResult);
    assert.strictEqual((state.generationResult as any).validatorResult.needs_rewrite, false);
    assert.deepStrictEqual((state.generationResult as any).validatorResult.issues, []);
    assert.strictEqual((state.generationResult as any).wasRewritten, true);
  });
});

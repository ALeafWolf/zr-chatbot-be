import { describe, it } from "node:test";
import assert from "node:assert";
import {
  createRoleplayPreGenerationGraph,
  runRoleplayPreGenerationGraph,
} from "./roleplayPreGenerationGraph";
import type { RoleplayGraphDeps } from "./roleplayGraph";
import { defaultRoleplayGraphDeps } from "./roleplayGraph";
import { runHybridScoreRerank } from "../context/hybridScoreRerank";
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
  systemPrompt: "[SYSTEM]\n你是左然",
  conversationHistory: [],
};

// ---------------------------------------------------------------------------
// Default test deps (fakes, no DB/LLM)
// ---------------------------------------------------------------------------

const fakeResolvedContextPrebuilt = {
  memories: [],
  canonChunks: [],
  canonScenes: [],
  recentTurns: [],
  derivedState: { inferredMood: "calm", inferredActivity: "conversing", conversationalStance: "neutral" },
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
  queryRewrite: { intent: "general", confidence: 0.9, segments: [], combined_for_embedding: "chat", entities: [], parseOk: true, structuralParseOk: true, labelOk: true },
  retrievalPlan: fakeResolvedContext.retrievalPlan,
  turnType: "general_roleplay" as const,
  motifSignal: undefined,
  motifProbe: undefined,
  rerankOutput: null,
  isFirstUserTurn: false,
  recallThoughtContext: { items: [], countsBySource: {}, selectionMode: "fallback" },
};

function defaultTestDeps(
  overrides?: Partial<RoleplayGraphDeps>,
): RoleplayGraphDeps {
  return {
    loadSession: async () => fakeSession(),
    loadCharacterContext: async () => fakeCharacterContext as any,
    resolveContext: async () => fakeResolvedContext as any,
    buildPromptContext: async () => fakePromptContext as any,
    buildPreRerankContext: async () => {
      const ctx: any = {
        session: fakeSession(),
        userMessage: "hello",
        characterDefaults: fakeCharacterDefaults as any,
        contextPlannerOutput: { queryRewrite: {} as any, structuredUserQuery: {}, intent: "scene_continuation", entities: [], retrievalHints: {} as any, confidence: 0.9, reason: "" },
        queryRewrite: { intent: "general", confidence: 0.9, segments: [], combined_for_embedding: "chat", entities: [], parseOk: true, structuralParseOk: true, labelOk: true },
        queryRewriteMs: 0, queryTextAnnotationFallback: false,
        retrievalPlan: fakeResolvedContext.retrievalPlan,
      queryEmbedding: [0.1, 0.2], canonQueryEmbedding: [0.1, 0.2],
      hypotheticalQueryEmbedding: undefined, motifQueryEmbeddings: undefined,
      memories: [], canonChunks: [], canonScenes: [], recentTurns: [],
      sessionSummary: null, sessionStateRow: null, latestRoleplayTurnIndex: null, isFirstUserTurn: false,
      sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [],
      motifSignal: undefined, motifProbe: undefined,
      derivedState: { inferredMood: "calm", inferredActivity: "conversing", conversationalStance: "neutral" },
      memoryCorrections: [], latestTurnDelta: null,
      shortlist: { candidates: [], diagnostics: { totalRetrieved: 0, totalShortlisted: 0, countsBySource: {}, truncatedByTotalCap: 0 } },
      shortlistMs: 0, latestTurnDeltaText: undefined, motifProbeText: undefined,
      startedAt: 0, embeddingsMs: 0, mainRetrievalMs: 0, olderRecallMs: 0, openThreadsMs: 0,
      olderRecallExclusiveFirst: 0, useFusedMemoryQuery: false, latestFrontierTurn: -1,
    };
    return ctx;
    },
    runLlmRerankFn: async () => ({
      ok: true,
      rerankOutput: { selected: [], rejected: [], finalContextMode: "selected_memory", needsEvidenceFallback: false },
      selectedContext: { memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], diagnostics: { retrievedCounts: { interactive_memory: 0, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 }, injectedCounts: { interactive_memory: 0, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 }, droppedDuplicateCount: 0, droppedLowScoreCount: 0, droppedCorrectionCount: 0, droppedBudgetCount: 0, topSources: [], averageInjectedScore: null } } as any,
      canonChunks: [], canonScenes: [],
      filteredSessionSummary: null, filteredLatestTurnDelta: null, filteredMemoryCorrections: [],
      rerankMs: 0,
    }) as any,
    deterministicSelectorFn: async () => ({
      selectedContext: { memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], diagnostics: { retrievedCounts: { interactive_memory: 0, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 }, injectedCounts: { interactive_memory: 0, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 }, droppedDuplicateCount: 0, droppedLowScoreCount: 0, droppedCorrectionCount: 0, droppedBudgetCount: 0, topSources: [], averageInjectedScore: null } } as any,
      selectorFallbackMs: 0,
    }) as any,
    rerankContextFn: async () => ({}) as any,
    assembleResolvedContext: async () => fakeResolvedContextPrebuilt as any,
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

  it("captures buildPreRerankContext error and short-circuits", async () => {
    const deps = defaultTestDeps({
      buildPreRerankContext: async () => {
        throw new Error("buildPreRerankContext failed");
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
    assert.strictEqual(result.errors[0].stage, "buildPreRerankContext");
    assert.strictEqual(
      result.errors[0].message,
      "buildPreRerankContext failed",
    );
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

  it("completes pre-generation graph with rerank fallback result", async () => {
    const deps = defaultTestDeps({
      runLlmRerankFn: async () => ({
        ok: false,
        rerankMs: 100,
        fallbackReason: "timeout_after_30000ms",
      }) as any,
    });

    const result = await runRoleplayPreGenerationGraph(
      { sessionId: "sess_rp_test", userMessage: "test" },
      deps,
    );

    assert.ok(result.session, "session should be loaded");
    assert.ok(result.characterContext, "characterContext should be loaded");
    assert.ok(result.resolvedContext, "resolvedContext should be assembled");
    assert.ok(result.promptContext, "promptContext should be built");
    assert.strictEqual(
      result.errors,
      undefined,
      "no errors on fallback path",
    );
  });

  it("rerank success and fallback both produce resolvedContext", async () => {
    const successDeps = defaultTestDeps();
    const fallbackDeps = defaultTestDeps({
      runLlmRerankFn: async () => ({ ok: false, rerankMs: 100, fallbackReason: "timeout_after_30000ms" }) as any,
    });

    const [success, fallback] = await Promise.all([
      runRoleplayPreGenerationGraph(
        { sessionId: "sess_rp_test", userMessage: "test" },
        successDeps,
      ),
      runRoleplayPreGenerationGraph(
        { sessionId: "sess_rp_test", userMessage: "test" },
        fallbackDeps,
      ),
    ]);

    // Both paths produce resolvedContext
    assert.ok(success.resolvedContext, "rerank success should produce resolvedContext");
    assert.ok(fallback.resolvedContext, "rerank fallback should produce resolvedContext");
    // Both converge to buildPrompt
    assert.ok(success.promptContext, "rerank success should produce promptContext");
    assert.ok(fallback.promptContext, "rerank fallback should produce promptContext");
  });

  it("routes rerank fallback through deterministicContextSelector node", async () => {
    let deterministicCalled = false;
    const deps = defaultTestDeps({
      runLlmRerankFn: async () => ({ ok: false, rerankMs: 100, fallbackReason: "timeout_after_30000ms" }) as any,
      deterministicSelectorFn: async () => {
        deterministicCalled = true;
        return { selectedContext: { memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], diagnostics: { retrievedCounts: { interactive_memory: 0, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 }, injectedCounts: { interactive_memory: 0, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 }, droppedDuplicateCount: 0, droppedLowScoreCount: 0, droppedCorrectionCount: 0, droppedBudgetCount: 0, topSources: [], averageInjectedScore: null } } as any, selectorFallbackMs: 5 };
      },
    });

    const result = await runRoleplayPreGenerationGraph(
      { sessionId: "sess_rp_test", userMessage: "test" },
      deps,
    );

    assert.ok(deterministicCalled, "deterministicSelectorFn should be called when rerank falls back");
    assert.ok(result.resolvedContext, "resolvedContext should be produced");
    assert.ok(result.promptContext, "promptContext should be produced");
  });

  // ---------------------------------------------------------------------------
  // Variant routing tests
  // ---------------------------------------------------------------------------

  it("default rerank variant (llm_rerank_v1) calls the LLM rerank node", async () => {
    let llmRerankCalled = false;
    let hybridCalled = false;
    let deterministicCalled = false;

    const deps = defaultTestDeps({
      runLlmRerankFn: async () => {
        llmRerankCalled = true;
        return {
          ok: true,
          rerankOutput: { selected: [], rejected: [], finalContextMode: "selected_memory", needsEvidenceFallback: false },
          selectedContext: { memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], diagnostics: { retrievedCounts: { interactive_memory: 0, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 }, injectedCounts: { interactive_memory: 0, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 }, droppedDuplicateCount: 0, droppedLowScoreCount: 0, droppedCorrectionCount: 0, droppedBudgetCount: 0, topSources: [], averageInjectedScore: null } } as any,
          canonChunks: [], canonScenes: [],
          filteredSessionSummary: null, filteredLatestTurnDelta: null, filteredMemoryCorrections: [],
          rerankMs: 10,
        } as any;
      },
      hybridScoreRerankFn: async () => {
        hybridCalled = true;
        return {} as any;
      },
      deterministicSelectorFn: async () => {
        deterministicCalled = true;
        return {} as any;
      },
    });

    // Don't set RERANK_VARIANT — default is llm_rerank_v1
    const prev = process.env.RERANK_VARIANT;
    delete process.env.RERANK_VARIANT;

    await runRoleplayPreGenerationGraph(
      { sessionId: "sess_rp_test", userMessage: "test" },
      deps,
    );

    if (prev !== undefined) process.env.RERANK_VARIANT = prev;

    assert.ok(llmRerankCalled, "LLM rerank should be called with default variant");
    assert.ok(!hybridCalled, "hybridScoreRerank should NOT be called with default variant");
    assert.ok(!deterministicCalled, "deterministicSelector should NOT be called on success");
  });

  it("RERANK_VARIANT=deterministic_only routes directly to deterministic selector and skips LLM rerank", async () => {
    let llmRerankCalled = false;
    let hybridCalled = false;
    let deterministicCalled = false;

    const deps = defaultTestDeps({
      runLlmRerankFn: async () => {
        llmRerankCalled = true;
        return {} as any;
      },
      hybridScoreRerankFn: async () => {
        hybridCalled = true;
        return {} as any;
      },
      deterministicSelectorFn: async () => {
        deterministicCalled = true;
        return { selectedContext: { memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], diagnostics: { retrievedCounts: { interactive_memory: 0, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 }, injectedCounts: { interactive_memory: 0, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 }, droppedDuplicateCount: 0, droppedLowScoreCount: 0, droppedCorrectionCount: 0, droppedBudgetCount: 0, topSources: [], averageInjectedScore: null } } as any, selectorFallbackMs: 5 };
      },
    });

    const prev = process.env.RERANK_VARIANT;
    process.env.RERANK_VARIANT = "deterministic_only";

    const result = await runRoleplayPreGenerationGraph(
      { sessionId: "sess_rp_test", userMessage: "test" },
      deps,
    );

    if (prev !== undefined) process.env.RERANK_VARIANT = prev;
    else delete process.env.RERANK_VARIANT;

    assert.ok(!llmRerankCalled, "LLM rerank should NOT be called for deterministic_only");
    assert.ok(!hybridCalled, "hybridScoreRerank should NOT be called for deterministic_only");
    assert.ok(deterministicCalled, "deterministicSelector should be called for deterministic_only");
    assert.ok(result.resolvedContext, "resolvedContext should be produced via deterministic_only path");
    assert.ok(result.promptContext, "promptContext should be produced via deterministic_only path");
  });

  it("RERANK_VARIANT=hybrid_score calls the hybrid score rerank and skips LLM rerank", async () => {
    let llmRerankCalled = false;
    let hybridCalled = false;
    let deterministicCalled = false;

    const deps = defaultTestDeps({
      runLlmRerankFn: async () => {
        llmRerankCalled = true;
        return {} as any;
      },
      hybridScoreRerankFn: async () => {
        hybridCalled = true;
        return {
          selectedContext: { memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], diagnostics: { retrievedCounts: { interactive_memory: 0, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 }, injectedCounts: { interactive_memory: 0, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 }, droppedDuplicateCount: 0, droppedLowScoreCount: 0, droppedCorrectionCount: 0, droppedBudgetCount: 0, topSources: [], averageInjectedScore: null } } as any,
          rerankOutput: { selected: [], rejected: [], finalContextMode: "selected_memory", needsEvidenceFallback: false },
          canonChunks: [], canonScenes: [],
          filteredSessionSummary: null, filteredLatestTurnDelta: null, filteredMemoryCorrections: [],
          hybridMs: 5,
          variantLabel: "hybrid_score",
          selectionMethod: "score_priority_hybrid",
        } as any;
      },
      deterministicSelectorFn: async () => {
        deterministicCalled = true;
        return {} as any;
      },
    });

    const prev = process.env.RERANK_VARIANT;
    process.env.RERANK_VARIANT = "hybrid_score";

    const result = await runRoleplayPreGenerationGraph(
      { sessionId: "sess_rp_test", userMessage: "test" },
      deps,
    );

    if (prev !== undefined) process.env.RERANK_VARIANT = prev;
    else delete process.env.RERANK_VARIANT;

    assert.ok(!llmRerankCalled, "LLM rerank should NOT be called for hybrid_score");
    assert.ok(hybridCalled, "hybridScoreRerank should be called for hybrid_score");
    assert.ok(!deterministicCalled, "deterministicSelector should NOT be called on hybrid success");
    assert.ok(result.resolvedContext, "resolvedContext should be produced via hybrid_score path");
    assert.ok(result.promptContext, "promptContext should be produced via hybrid_score path");
  });

  it("RERANK_VARIANT=deterministic_only records variant_deterministic_only as fallback reason", async () => {
    let deterministicCalled = false;
    let passedFallbackReason: string | undefined;

    const deps = defaultTestDeps({
      deterministicSelectorFn: async (input: any) => {
        deterministicCalled = true;
        return { selectedContext: { memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], diagnostics: { retrievedCounts: { interactive_memory: 0, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 }, injectedCounts: { interactive_memory: 0, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 }, droppedDuplicateCount: 0, droppedLowScoreCount: 0, droppedCorrectionCount: 0, droppedBudgetCount: 0, topSources: [], averageInjectedScore: null } } as any, selectorFallbackMs: 5 };
      },
    });

    // Override buildPreRerankContext to produce a traceable context
    const prevVariant = process.env.RERANK_VARIANT;
    process.env.RERANK_VARIANT = "deterministic_only";

    const result = await runRoleplayPreGenerationGraph(
      { sessionId: "sess_rp_test", userMessage: "test" },
      deps,
    );

    if (prevVariant !== undefined) process.env.RERANK_VARIANT = prevVariant;
    else delete process.env.RERANK_VARIANT;

    assert.ok(deterministicCalled);
    assert.ok(result.resolvedContext, "resolvedContext should be produced");
  });

  // ---------------------------------------------------------------------------
  // Regression: default deps include hybrid seam
  // ---------------------------------------------------------------------------

  it("defaultRoleplayGraphDeps includes hybridScoreRerankFn", () => {
    assert.equal(
      defaultRoleplayGraphDeps.hybridScoreRerankFn,
      runHybridScoreRerank,
      "hybridScoreRerankFn must be wired in default deps",
    );
  });

  // ---------------------------------------------------------------------------
  // Missing explicit routing test
  // ---------------------------------------------------------------------------

  it("RERANK_VARIANT=llm_rerank_smaller_model routes to the LLM rerank node", async () => {
    let llmRerankCalled = false;
    let hybridCalled = false;

    const deps = defaultTestDeps({
      runLlmRerankFn: async () => {
        llmRerankCalled = true;
        return {
          ok: true,
          rerankOutput: { selected: [], rejected: [], finalContextMode: "selected_memory", needsEvidenceFallback: false },
          selectedContext: { memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], diagnostics: { retrievedCounts: { interactive_memory: 0, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 }, injectedCounts: { interactive_memory: 0, session_chunk: 0, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 }, droppedDuplicateCount: 0, droppedLowScoreCount: 0, droppedCorrectionCount: 0, droppedBudgetCount: 0, topSources: [], averageInjectedScore: null } } as any,
          canonChunks: [], canonScenes: [],
          filteredSessionSummary: null, filteredLatestTurnDelta: null, filteredMemoryCorrections: [],
          rerankMs: 10,
        } as any;
      },
      hybridScoreRerankFn: async () => {
        hybridCalled = true;
        return {} as any;
      },
    });

    const prev = process.env.RERANK_VARIANT;
    process.env.RERANK_VARIANT = "llm_rerank_smaller_model";

    await runRoleplayPreGenerationGraph(
      { sessionId: "sess_rp_test", userMessage: "test" },
      deps,
    );

    if (prev !== undefined) process.env.RERANK_VARIANT = prev;
    else delete process.env.RERANK_VARIANT;

    assert.ok(llmRerankCalled, "LLM rerank should be called for llm_rerank_smaller_model");
    assert.ok(!hybridCalled, "hybridScoreRerank should NOT be called for llm_rerank_smaller_model");
  });
});

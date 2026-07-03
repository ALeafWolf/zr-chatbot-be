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
import { env } from "../../config/env";

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
  archetype: "wandering_scholar",
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

  it("captures node errors and short-circuits downstream stages", async () => {
    const scenarios: Array<{ stage: string; msg: string; override: Record<string, any>; checks: (r: any) => void }> = [
      { stage: "loadSession", msg: "DB unavailable", override: { loadSession: async () => { throw new Error("DB unavailable"); } }, checks: (r) => { assert.strictEqual(r.session, undefined, "session not set"); assert.strictEqual(r.characterContext, undefined, "characterContext not set"); } },
      { stage: "loadCharacterContext", msg: "character context unavailable", override: { loadCharacterContext: async () => { throw new Error("character context unavailable"); } }, checks: (r) => { assert.ok(r.session, "session loaded"); assert.strictEqual(r.characterContext, undefined, "characterContext not set"); } },
      { stage: "buildPreRerankContext", msg: "buildPreRerankContext failed", override: { buildPreRerankContext: async () => { throw new Error("buildPreRerankContext failed"); } }, checks: (r) => { assert.ok(r.characterContext, "characterContext loaded"); assert.strictEqual(r.resolvedContext, undefined, "resolvedContext not set"); } },
      { stage: "buildPrompt", msg: "prompt build failed", override: { buildPromptContext: async () => { throw new Error("prompt build failed"); } }, checks: (r) => { assert.ok(r.resolvedContext, "resolvedContext loaded"); assert.strictEqual(r.promptContext, undefined, "promptContext not set"); } },
    ];
    for (const s of scenarios) {
      const deps = defaultTestDeps(s.override);
      const result = await runRoleplayPreGenerationGraph({ sessionId: "sess_rp_test", userMessage: "test" }, deps);
      assert.ok(result.errors, `${s.stage} — errors`);
      assert.strictEqual(result.errors.length, 1, `${s.stage} — 1 error`);
      assert.strictEqual(result.errors[0].stage, s.stage, `${s.stage} — stage`);
      assert.strictEqual(result.errors[0].message, s.msg, `${s.stage} — message`);
      assert.strictEqual(result.promptContext, undefined, `${s.stage} — promptContext not set`);
      s.checks(result);
    }
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
  // ---------------------------------------------------------------------------
  // TG2 — Response director node
  // ---------------------------------------------------------------------------

  it("responseDirector node: when enabled and successful, [DIRECTOR NOTE] block is appended to systemPrompt", async () => {
    const savedEnabled = (env as any).RESPONSE_DIRECTOR_ENABLED;
    try {
      (env as any).RESPONSE_DIRECTOR_ENABLED = true;

      let directorCalled = false;
      const deps = defaultTestDeps({
        runResponseDirectorFn: async () => {
          directorCalled = true;
          return { note: "场景框架：测试场景\n行为基调：保持温和", output: { scene_frame: "测试场景", input_reading: "", mood_directive: "保持温和", fact_correction: "", beats: [], avoid: [], stage_gate: "", format_resistance: "", direction_execution: "" } };
        },
      });

      const result = await runRoleplayPreGenerationGraph(
        { sessionId: "sess_rp_test", userMessage: "test" },
        deps,
      );

      assert.ok(directorCalled, "responseDirectorFn should be called when enabled");
      assert.ok(result.promptContext, "promptContext should exist");
      assert.ok(
        result.promptContext!.systemPrompt.includes("[DIRECTOR NOTE]"),
        "systemPrompt should contain [DIRECTOR NOTE] block",
      );
      assert.ok(
        result.promptContext!.systemPrompt.includes("场景框架：测试场景"),
        "director note content should be in systemPrompt",
      );
    } finally {
      (env as any).RESPONSE_DIRECTOR_ENABLED = savedEnabled;
    }
  });

  it("responseDirector node: disabled flag is a no-op (no LLM call, promptContext unchanged)", async () => {
    const savedEnabled = (env as any).RESPONSE_DIRECTOR_ENABLED;
    try {
      (env as any).RESPONSE_DIRECTOR_ENABLED = false;

      let directorCalled = false;
      const deps = defaultTestDeps({
        runResponseDirectorFn: async () => {
          directorCalled = true;
          return { note: "some block", output: { scene_frame: "", input_reading: "", mood_directive: "", fact_correction: "", beats: [], avoid: [], stage_gate: "", format_resistance: "", direction_execution: "" } };
        },
      });

      const result = await runRoleplayPreGenerationGraph(
        { sessionId: "sess_rp_test", userMessage: "test" },
        deps,
      );

      assert.ok(!directorCalled, "responseDirectorFn should NOT be called when disabled");
      assert.ok(result.promptContext, "promptContext should exist");
      assert.equal(
        result.promptContext!.systemPrompt.includes("[DIRECTOR NOTE]"),
        false,
        "systemPrompt should NOT contain [DIRECTOR NOTE] when disabled",
      );
      assert.strictEqual(result.errors, undefined, "no errors when disabled");
    } finally {
      (env as any).RESPONSE_DIRECTOR_ENABLED = savedEnabled;
    }
  });

  it("responseDirector node: error in directorFn is fail-open (promptContext unchanged, no errors)", async () => {
    const savedEnabled = (env as any).RESPONSE_DIRECTOR_ENABLED;
    try {
      (env as any).RESPONSE_DIRECTOR_ENABLED = true;

      const deps = defaultTestDeps({
        runResponseDirectorFn: async () => {
          throw new Error("director failure");
        },
      });

      const result = await runRoleplayPreGenerationGraph(
        { sessionId: "sess_rp_test", userMessage: "test" },
        deps,
      );

      assert.ok(result.promptContext, "promptContext should exist even after director error");
      assert.equal(
        result.promptContext!.systemPrompt.includes("[DIRECTOR NOTE]"),
        false,
        "systemPrompt should NOT contain [DIRECTOR NOTE] on error",
      );
      assert.strictEqual(result.errors, undefined, "errors should be undefined (fail-open, not errorSink)");
    } finally {
      (env as any).RESPONSE_DIRECTOR_ENABLED = savedEnabled;
    }
  });

  it("responseDirector node: returns null is fail-open (no block appended)", async () => {
    const savedEnabled = (env as any).RESPONSE_DIRECTOR_ENABLED;
    try {
      (env as any).RESPONSE_DIRECTOR_ENABLED = true;

      const deps = defaultTestDeps({
        runResponseDirectorFn: async () => null,
      });

      const result = await runRoleplayPreGenerationGraph(
        { sessionId: "sess_rp_test", userMessage: "test" },
        deps,
      );

      assert.ok(result.promptContext, "promptContext exists");
      assert.equal(
        result.promptContext!.systemPrompt.includes("[DIRECTOR NOTE]"),
        false,
        "no block when director returns null",
      );
    } finally {
      (env as any).RESPONSE_DIRECTOR_ENABLED = savedEnabled;
    }
  });

  it("responseDirector node: spy captures actual ResponseDirectorInput (F2)", async () => {
    const savedEnabled = (env as any).RESPONSE_DIRECTOR_ENABLED;
    try {
      (env as any).RESPONSE_DIRECTOR_ENABLED = true;

      let capturedInput: any = null;

      // Build a resolved context with real segments
      const contextWithSegments = {
        ...fakeResolvedContextPrebuilt,
        queryRewrite: {
          intent: "general" as const,
          confidence: 0.9,
          segments: [
            { lane: "user_speech" as const, text: "你好" },
            { lane: "reply_direction" as const, text: "请温柔回应" },
          ],
          combined_for_embedding: "[user speech] 你好\n[reply direction suggestion]: 请温柔回应",
          entities: [],
          parseOk: true,
          structuralParseOk: true,
          labelOk: true,
        },
        openThreads: [
          { id: "t1", source: "session_summary" as const, text: "answer the pending question", status: "open" as const, sourceTurnIndex: 2, score: 0.9 },
        ],
        latestTurnDelta: {
          kind: "latest_turn_delta" as const,
          sourceTurnStart: 2,
          sourceTurnEnd: 3,
          expiresAfterTurn: 7,
          facts: ["the user asked to resume the scene"],
          pendingActions: [],
          relationshipSignals: [],
        },
      };

      // Build a prompt context with reply directions and emotional data
      const promptContextWithData = {
        ...fakePromptContext,
        replyDirections: ["请温柔回应"],
        emotionalBandLine: "亲近：中 情绪：中 唤起：低 克制：高",
        emotionalRenderRuleTexts: ["R1: 放松改变的是温度"],
        emotionalLastTraceEvent: "user_shows_warmth",
        canonTruthMode: "open_roleplay" as const,
        selectedMemorySources: [],
      };

      const deps = defaultTestDeps({
        assembleResolvedContext: async () => contextWithSegments as any,
        buildPromptContext: async () => promptContextWithData as any,
        runResponseDirectorFn: async (input: any) => {
          capturedInput = input;
          return { note: "场景框架：测试场景", output: { scene_frame: "测试场景", input_reading: "", mood_directive: "", fact_correction: "", beats: [], avoid: [], stage_gate: "", format_resistance: "", direction_execution: "" } };
        },
      });

      await runRoleplayPreGenerationGraph(
        { sessionId: "sess_rp_test", userMessage: "你好【请温柔】吗？" },
        deps,
      );

      assert.ok(capturedInput, "spy should have received the director input");
      assert.ok(capturedInput.segments, "segments present");
      assert.equal(capturedInput.segments.length, 2, "segments count");
      assert.ok(capturedInput.replyDirections, "replyDirections present");
      assert.equal(capturedInput.replyDirections[0], "请温柔回应", "reply direction");
      assert.ok(capturedInput.bandLine, "bandLine");
      assert.ok(capturedInput.openThreadTitles.length > 0, "open threads");
      assert.ok(capturedInput.latestTurnDeltaFacts.length > 0, "turn delta facts");
      // TG5: characterDigest and continuityScope are populated
      assert.ok("characterDigest" in capturedInput, "characterDigest present in input");
      assert.ok("continuityScope" in capturedInput, "continuityScope present in input");
      // No internal_logic in fakeCharacterDefaults → digest is empty
      assert.equal(capturedInput.characterDigest, "", "characterDigest empty when no internal_logic");
      // Session has continuityScope="main"
      assert.equal(capturedInput.continuityScope, "main", "continuityScope from session");
    } finally {
      (env as any).RESPONSE_DIRECTOR_ENABLED = savedEnabled;
    }
  });

  it("responseDirector node: characterDigest populated from characterDefaults.internal_logic, continuityScope from session", async () => {
    const savedEnabled = (env as any).RESPONSE_DIRECTOR_ENABLED;
    try {
      (env as any).RESPONSE_DIRECTOR_ENABLED = true;
      let capturedInput: any = null;

      // Character with internal_logic
      const characterWithDigest = {
        ...fakeCharacterContext,
        characterDefaults: {
          ...fakeCharacterDefaults,
          internal_logic: {
            core_motivation: "守护珍视的人",
            core_fear: "辜负他人",
            defense_mechanism: "沉默/转移话题",
            transition_rule: "克制→停顿→试探性松动",
            relationship_scope_gate: "与关系阶段匹配",
          },
        },
      };

      const deps = defaultTestDeps({
        loadCharacterContext: async () => characterWithDigest as any,
        runResponseDirectorFn: async (input: any) => {
          capturedInput = input;
          return { note: "场景框架：test", output: { scene_frame: "test", input_reading: "", mood_directive: "", fact_correction: "", beats: [], avoid: [], stage_gate: "", format_resistance: "", direction_execution: "" } };
        },
      });

      await runRoleplayPreGenerationGraph(
        { sessionId: "sess_rp_test", userMessage: "你好" },
        deps,
      );

      assert.ok(capturedInput, "captured input");
      assert.ok(capturedInput.characterDigest, "characterDigest should be non-empty");
      assert.ok(capturedInput.characterDigest.includes("守护珍视的人"), "digest contains internal_logic content");
      assert.equal(capturedInput.continuityScope, "main", "continuityScope from session");
    } finally {
      (env as any).RESPONSE_DIRECTOR_ENABLED = savedEnabled;
    }
  });

  it("responseDirector node: characterDigest is empty when characterContext has no internal_logic", async () => {
    const savedEnabled = (env as any).RESPONSE_DIRECTOR_ENABLED;
    try {
      (env as any).RESPONSE_DIRECTOR_ENABLED = true;
      let capturedInput: any = null;

      // Character with undefined internal_logic
      const characterNoDigest = {
        ...fakeCharacterContext,
        characterDefaults: {
          ...fakeCharacterDefaults,
          internal_logic: undefined,
        },
      };

      const deps = defaultTestDeps({
        loadCharacterContext: async () => characterNoDigest as any,
        runResponseDirectorFn: async (input: any) => {
          capturedInput = input;
          return { note: "场景框架：test", output: { scene_frame: "test", input_reading: "", mood_directive: "", fact_correction: "", beats: [], avoid: [], stage_gate: "", format_resistance: "", direction_execution: "" } };
        },
      });

      await runRoleplayPreGenerationGraph(
        { sessionId: "sess_rp_test", userMessage: "你好" },
        deps,
      );

      assert.ok(capturedInput, "captured input");
      assert.equal(capturedInput.characterDigest, "", "characterDigest empty when no internal_logic");
    } finally {
      (env as any).RESPONSE_DIRECTOR_ENABLED = savedEnabled;
    }
  });

  // ---------------------------------------------------------------------------
  // TG1 (phase2c) — Memory entry previews
  // ---------------------------------------------------------------------------

  it("responseDirector node: memoryEntryPreviews populated from resolved-context memory arrays in category order", async () => {
    const savedEnabled = (env as any).RESPONSE_DIRECTOR_ENABLED;
    try {
      (env as any).RESPONSE_DIRECTOR_ENABLED = true;
      let capturedInput: any = null;

      const contextWithMemories = {
        ...fakeResolvedContextPrebuilt,
        structMemEntries: [
          { id: "e1", entryType: "dialogue", turnIndex: 3, text: "左然说他会等很久", importanceScore: null, confidenceScore: null, cosineSimilarity: 0.9, finalScore: 0.9 },
        ],
        structMemConsolidations: [
          { id: "c1", scope: "current_session", summaryText: "用户与左然重归于好", turnStart: 1, turnEnd: 10, confidenceScore: null, cosineSimilarity: 0.8, finalScore: 0.8 },
        ],
        memories: [
          { id: "m1", memoryType: "observation", summary: "用户今天情绪不高", importanceScore: 0.5, emotionScore: 0, reuseCount: 0, cosineSimilarity: 0.7 },
        ],
        sessionRecall: [
          { id: "r1", turnStart: 1, turnEnd: 2, chunkText: "用户说想重新开始", chunkType: "session_chunk", cosineSimilarity: 0.6, finalScore: 0.6 },
        ],
      };

      const deps = defaultTestDeps({
        assembleResolvedContext: async () => contextWithMemories as any,
        runResponseDirectorFn: async (input: any) => {
          capturedInput = input;
          return { note: "scene test", output: { scene_frame: "test", input_reading: "", mood_directive: "", fact_correction: "", beats: [], avoid: [], stage_gate: "", format_resistance: "", direction_execution: "" } };
        },
      });

      await runRoleplayPreGenerationGraph(
        { sessionId: "sess_rp_test", userMessage: "你好" },
        deps,
      );

      assert.ok(capturedInput, "captured input");
      assert.ok(Array.isArray(capturedInput.memoryEntryPreviews), "memoryEntryPreviews is array");
      assert.equal(capturedInput.memoryEntryPreviews.length, 4, "4 previews from 4 categories");

      // Category order: 事件记忆 → 记忆综合 → 互动记忆 → 会话回溯
      assert.ok(capturedInput.memoryEntryPreviews[0].startsWith("[事件记忆|"), "first is struct mem entry");
      assert.ok(capturedInput.memoryEntryPreviews[1].startsWith("[记忆综合|"), "second is consolidation");
      assert.ok(capturedInput.memoryEntryPreviews[2].startsWith("[互动记忆|"), "third is interactive memory");
      assert.ok(capturedInput.memoryEntryPreviews[3].startsWith("[会话回溯|"), "fourth is session recall");

      // 160-char truncation: the body text is short, so no truncation
      assert.ok(capturedInput.memoryEntryPreviews[0].length <= 200, "preview line within reasonable length");
    } finally {
      (env as any).RESPONSE_DIRECTOR_ENABLED = savedEnabled;
    }
  });

  it("responseDirector node: memoryEntryPreviews capped at 10 lines with empty-body skipping", async () => {
    const savedEnabled = (env as any).RESPONSE_DIRECTOR_ENABLED;
    try {
      (env as any).RESPONSE_DIRECTOR_ENABLED = true;
      let capturedInput: any = null;

      // Create 15 struct mem entries to test the 10-line cap
      const manyEntries = Array.from({ length: 15 }, (_, i) => ({
        id: `e${i}`, entryType: "dialogue", turnIndex: i, text: `记忆条目第${i + 1}条`,
        importanceScore: null, confidenceScore: null, cosineSimilarity: 0.9, finalScore: 0.9,
      }));

      const contextWithMany = {
        ...fakeResolvedContextPrebuilt,
        structMemEntries: manyEntries,
        structMemConsolidations: [],
        memories: [],
        sessionRecall: [],
      };

      const deps = defaultTestDeps({
        assembleResolvedContext: async () => contextWithMany as any,
        buildPromptContext: async () => ({
          systemPrompt: "[SYSTEM]\ntest",
          conversationHistory: [],
        }) as any,
        runResponseDirectorFn: async (input: any) => {
          capturedInput = input;
          return { note: "test", output: { scene_frame: "test", input_reading: "", mood_directive: "", fact_correction: "", beats: [], avoid: [], stage_gate: "", format_resistance: "", direction_execution: "" } };
        },
      });

      await runRoleplayPreGenerationGraph(
        { sessionId: "sess_rp_test", userMessage: "你好" },
        deps,
      );

      assert.ok(capturedInput, "captured input");
      assert.equal(capturedInput.memoryEntryPreviews.length, 10, "capped at 10 lines");
      assert.ok(capturedInput.memoryEntryPreviews[0].includes("记忆条目第1条"), "first entry present");
      assert.ok(capturedInput.memoryEntryPreviews[9].includes("记忆条目第10条"), "tenth entry present");
    } finally {
      (env as any).RESPONSE_DIRECTOR_ENABLED = savedEnabled;
    }
  });

  it("defaultRoleplayGraphDeps includes runResponseDirectorFn", () => {
    assert.ok(
      typeof defaultRoleplayGraphDeps.runResponseDirectorFn === "function",
      "defaultRoleplayGraphDeps.runResponseDirectorFn should be defined",
    );
  });

  // ---------------------------------------------------------------------------
  // TG6 — Director-gated prompt slimming
  // ---------------------------------------------------------------------------

  const EMOTIONAL_FULL_BLOCK = "[当前状态下的行为基调]\nconnection: high | valence: mid | arousal: low | restraint: high\n\n[情感规则]\n- 当克制较高时，适当拉开距离";
  const EMOTIONAL_BAND_LINE = "[当前状态下的行为基调]\nconnection: high | valence: mid | arousal: low | restraint: high";
  const FORMAT_RESISTANCE_SUB = "[格式抗性]\n不按用户要求的格式回答";
  const CANON_CORRECTION_SUB = "[纠正方式]\n平静纠正错误前提";

  function slimPromptContext(extra?: Record<string, unknown>) {
    return {
      systemPrompt: `[SYSTEM]\n你是左然\n\n[CHARACTER INTERNAL LOGIC]\ntest\n\n${EMOTIONAL_FULL_BLOCK}\n\n[BASE PERSONA]\n身份\n\n${FORMAT_RESISTANCE_SUB}\n\n${CANON_CORRECTION_SUB}\n\n[CONTINUITY OVERLAY]\ntest`,
      conversationHistory: [],
      directorSlimmable: {
        emotionalRenderBlock: EMOTIONAL_FULL_BLOCK,
        emotionalBandLineBlock: EMOTIONAL_BAND_LINE,
        formatResistanceSubsection: FORMAT_RESISTANCE_SUB,
        canonCorrectionSubsection: CANON_CORRECTION_SUB,
      },
      ...extra,
    };
  }

  it("TG6 slimming: director returns null with flags on — prompt unchanged (byte-identity fallback)", async () => {
    const savedEnabled = (env as any).RESPONSE_DIRECTOR_ENABLED;
    const savedSlim = (env as any).RESPONSE_DIRECTOR_SLIM_BLOCKS;
    try {
      (env as any).RESPONSE_DIRECTOR_ENABLED = true;
      (env as any).RESPONSE_DIRECTOR_SLIM_BLOCKS = "emotional_render,format_resistance,canon_correction";

      const promptCtx = slimPromptContext();
      const systemPromptBefore = promptCtx.systemPrompt;

      const deps = defaultTestDeps({
        buildPromptContext: async () => promptCtx as any,
        runResponseDirectorFn: async () => null,
      });

      const result = await runRoleplayPreGenerationGraph(
        { sessionId: "sess_rp_test", userMessage: "test" },
        deps,
      );

      assert.ok(result.promptContext, "promptContext exists");
      assert.equal(result.promptContext!.systemPrompt, systemPromptBefore, "prompt byte-identical when director returns null");
      assert.equal(result.promptContext!.directorSlimmedBlocks, undefined, "no slimmedBlocks when director returns null");
    } finally {
      (env as any).RESPONSE_DIRECTOR_ENABLED = savedEnabled;
      (env as any).RESPONSE_DIRECTOR_SLIM_BLOCKS = savedSlim;
    }
  });

  it("TG6 slimming: emotional_render replaces full block with band-line-only when mood_directive is non-empty", async () => {
    const savedEnabled = (env as any).RESPONSE_DIRECTOR_ENABLED;
    const savedSlim = (env as any).RESPONSE_DIRECTOR_SLIM_BLOCKS;
    try {
      (env as any).RESPONSE_DIRECTOR_ENABLED = true;
      (env as any).RESPONSE_DIRECTOR_SLIM_BLOCKS = "emotional_render";

      const promptCtx = slimPromptContext();

      const deps = defaultTestDeps({
        buildPromptContext: async () => promptCtx as any,
        runResponseDirectorFn: async () => ({
          note: "场景框架：测试",
          output: {
            scene_frame: "测试", input_reading: "", mood_directive: "保持温和",
            fact_correction: "", beats: [], avoid: [], stage_gate: "",
            format_resistance: "", direction_execution: "",
          },
        }),
      });

      const result = await runRoleplayPreGenerationGraph(
        { sessionId: "sess_rp_test", userMessage: "test" },
        deps,
      );

      const sp = result.promptContext!.systemPrompt;
      // Full block text should NOT appear; band-line-only should appear exactly once
      assert.equal(sp.includes(EMOTIONAL_FULL_BLOCK), false, "full emotional block text removed");
      assert.ok(sp.includes(EMOTIONAL_BAND_LINE), "band-line-only block present");
      // Count band-line occurrences: exactly 1 (the replacement) — the note itself doesn't contain it
      const bandLineCount = sp.split(EMOTIONAL_BAND_LINE).length - 1;
      assert.equal(bandLineCount, 1, "band-line-only block appears exactly once");
      // [DIRECTOR NOTE] is still appended last
      assert.ok(sp.includes("[DIRECTOR NOTE]"), "DIRECTOR NOTE appended");
      assert.ok(result.promptContext!.directorSlimmedBlocks?.includes("emotional_render"), "slimmedBlocks includes emotional_render");
    } finally {
      (env as any).RESPONSE_DIRECTOR_ENABLED = savedEnabled;
      (env as any).RESPONSE_DIRECTOR_SLIM_BLOCKS = savedSlim;
    }
  });

  it("TG6 slimming: format_resistance subsection removed when field fired", async () => {
    const savedEnabled = (env as any).RESPONSE_DIRECTOR_ENABLED;
    const savedSlim = (env as any).RESPONSE_DIRECTOR_SLIM_BLOCKS;
    try {
      (env as any).RESPONSE_DIRECTOR_ENABLED = true;
      (env as any).RESPONSE_DIRECTOR_SLIM_BLOCKS = "format_resistance";

      const promptCtx = slimPromptContext();

      const deps = defaultTestDeps({
        buildPromptContext: async () => promptCtx as any,
        runResponseDirectorFn: async () => ({
          note: "场景框架：测试",
          output: {
            scene_frame: "测试", input_reading: "", mood_directive: "",
            fact_correction: "", beats: [], avoid: [], stage_gate: "",
            format_resistance: "拒绝框架式回答",  // fired!
            direction_execution: "",
          },
        }),
      });

      const result = await runRoleplayPreGenerationGraph(
        { sessionId: "sess_rp_test", userMessage: "test" },
        deps,
      );

      const sp = result.promptContext!.systemPrompt;
      assert.equal(sp.includes(FORMAT_RESISTANCE_SUB), false, "formatResistance subsection removed when fired");
      assert.ok(sp.includes(CANON_CORRECTION_SUB), "canonCorrection subsection still present (not flagged)");
      assert.ok(result.promptContext!.directorSlimmedBlocks?.includes("format_resistance"), "slimmedBlocks includes format_resistance");
    } finally {
      (env as any).RESPONSE_DIRECTOR_ENABLED = savedEnabled;
      (env as any).RESPONSE_DIRECTOR_SLIM_BLOCKS = savedSlim;
    }
  });

  it("TG6 slimming: format_resistance subsection kept when field NOT fired", async () => {
    const savedEnabled = (env as any).RESPONSE_DIRECTOR_ENABLED;
    const savedSlim = (env as any).RESPONSE_DIRECTOR_SLIM_BLOCKS;
    try {
      (env as any).RESPONSE_DIRECTOR_ENABLED = true;
      (env as any).RESPONSE_DIRECTOR_SLIM_BLOCKS = "format_resistance";

      const promptCtx = slimPromptContext();

      const deps = defaultTestDeps({
        buildPromptContext: async () => promptCtx as any,
        runResponseDirectorFn: async () => ({
          note: "场景框架：测试",
          output: {
            scene_frame: "测试", input_reading: "", mood_directive: "",
            fact_correction: "", beats: [], avoid: [], stage_gate: "",
            format_resistance: "",  // NOT fired
            direction_execution: "",
          },
        }),
      });

      const result = await runRoleplayPreGenerationGraph(
        { sessionId: "sess_rp_test", userMessage: "test" },
        deps,
      );

      const sp = result.promptContext!.systemPrompt;
      assert.ok(sp.includes(FORMAT_RESISTANCE_SUB), "formatResistance subsection kept when not fired");
      assert.equal(result.promptContext!.directorSlimmedBlocks, undefined, "no slimmedBlocks when nothing slimmed");
    } finally {
      (env as any).RESPONSE_DIRECTOR_ENABLED = savedEnabled;
      (env as any).RESPONSE_DIRECTOR_SLIM_BLOCKS = savedSlim;
    }
  });

  it("TG6 slimming: canon_correction subsection removed when fact_correction fired", async () => {
    const savedEnabled = (env as any).RESPONSE_DIRECTOR_ENABLED;
    const savedSlim = (env as any).RESPONSE_DIRECTOR_SLIM_BLOCKS;
    try {
      (env as any).RESPONSE_DIRECTOR_ENABLED = true;
      (env as any).RESPONSE_DIRECTOR_SLIM_BLOCKS = "canon_correction";

      const promptCtx = slimPromptContext();

      const deps = defaultTestDeps({
        buildPromptContext: async () => promptCtx as any,
        runResponseDirectorFn: async () => ({
          note: "场景框架：测试",
          output: {
            scene_frame: "测试", input_reading: "", mood_directive: "",
            fact_correction: "纠正某个前提",  // fired!
            beats: [], avoid: [], stage_gate: "",
            format_resistance: "", direction_execution: "",
          },
        }),
      });

      const result = await runRoleplayPreGenerationGraph(
        { sessionId: "sess_rp_test", userMessage: "test" },
        deps,
      );

      const sp = result.promptContext!.systemPrompt;
      assert.equal(sp.includes(CANON_CORRECTION_SUB), false, "canonCorrection subsection removed when fired");
      assert.ok(sp.includes(FORMAT_RESISTANCE_SUB), "formatResistance subsection still present (not flagged)");
      assert.ok(result.promptContext!.directorSlimmedBlocks?.includes("canon_correction"), "slimmedBlocks includes canon_correction");
    } finally {
      (env as any).RESPONSE_DIRECTOR_ENABLED = savedEnabled;
      (env as any).RESPONSE_DIRECTOR_SLIM_BLOCKS = savedSlim;
    }
  });

  it("TG6 slimming: match failure leaves prompt untouched and warns (simulated by tampered slimmable)", async () => {
    const savedEnabled = (env as any).RESPONSE_DIRECTOR_ENABLED;
    const savedSlim = (env as any).RESPONSE_DIRECTOR_SLIM_BLOCKS;
    try {
      (env as any).RESPONSE_DIRECTOR_ENABLED = true;
      (env as any).RESPONSE_DIRECTOR_SLIM_BLOCKS = "emotional_render";

      // Tampered slimmable: the emotionalRenderBlock string does NOT appear in systemPrompt
      const promptCtx = {
        systemPrompt: "[SYSTEM]\n你是左然\n\n[BASE PERSONA]\n身份",
        conversationHistory: [],
        directorSlimmable: {
          emotionalRenderBlock: "[当前状态下的行为基调]\nnonexistent content",
          emotionalBandLineBlock: "[当前状态下的行为基调]\nband only",
        },
      };
      const systemPromptBefore = promptCtx.systemPrompt;

      const deps = defaultTestDeps({
        buildPromptContext: async () => promptCtx as any,
        runResponseDirectorFn: async () => ({
          note: "场景框架：测试",
          output: {
            scene_frame: "测试", input_reading: "", mood_directive: "保持温和",
            fact_correction: "", beats: [], avoid: [], stage_gate: "",
            format_resistance: "", direction_execution: "",
          },
        }),
      });

      const result = await runRoleplayPreGenerationGraph(
        { sessionId: "sess_rp_test", userMessage: "test" },
        deps,
      );

      // Prompt should be unchanged except for the appended note
      assert.ok(result.promptContext!.systemPrompt.startsWith(systemPromptBefore), "prompt prefix unchanged on match failure");
      assert.ok(result.promptContext!.systemPrompt.includes("[DIRECTOR NOTE]"), "note still appended");
      assert.equal(result.promptContext!.directorSlimmedBlocks, undefined, "no slimmedBlocks on match failure");
    } finally {
      (env as any).RESPONSE_DIRECTOR_ENABLED = savedEnabled;
      (env as any).RESPONSE_DIRECTOR_SLIM_BLOCKS = savedSlim;
    }
  });

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

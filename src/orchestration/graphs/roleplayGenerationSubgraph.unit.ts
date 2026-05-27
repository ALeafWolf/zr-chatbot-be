import { describe, it } from "node:test";
import assert from "node:assert";
import { createGenerationSubgraph } from "./roleplayGenerationSubgraph";
import type { RoleplayGraphDeps } from "./roleplayGraph";
import { buildValidatorContext } from "../generation/generateAndValidate";

function makeMinDeps(): RoleplayGraphDeps {
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

describe("createGenerationSubgraph", () => {
  it("completes the success path with a generationResult", async () => {
    const { graph } = createGenerationSubgraph(makeMinDeps());
    const state = await (graph.invoke as any)({
      sessionId: "sess_test",
      userMessage: "hello",
      promptContext: { systemPrompt: "[SYSTEM]\n你是左然", conversationHistory: [] },
      session: { sessionId: "sess_test", characterId: "zuo_ran", continuityScope: "main", continuityFamily: "main_world", mode: "canonical_live", memoryNamespace: "main" },
      characterContext: {
        characterDefaults: { character_id: "zuo_ran", name: "Zuo Ran", safe_deflection: "I am not sure." },
        personaOverlay: { max_nsfw_level: "none", escalation_rule: "", out_of_scope_chapter_behavior: "" },
             overlayId: "main", voiceHints: "formal, restrained",
      },
    });

    assert.ok(state.generationResult, "generationResult should be produced");
    assert.strictEqual((state.generationResult as any).content, "Graph generated response.");
    assert.strictEqual((state.generationResult as any).wasRewritten, false);
    assert.strictEqual((state.generationResult as any).wasDeflected, false);
  });

  it("produces result via safeDeflection on tool loop error", async () => {
    const deps = makeMinDeps();
    deps.generateDraftFn = async function* () {
      throw Object.assign(new Error("Tool loop"), { name: "ToolLoopExceededError" });
    } as any;
    deps.safeDeflectionFn = async function* () {
      return { content: "Safe deflection.", wasDeflected: true, wasRewritten: false, inputTokens: 0, outputTokens: 0, validatorResult: { in_character: true, canon_consistent: true, session_state_consistent: true, nsfw_within_bounds: true, issues: [], needs_rewrite: false } } as any;
    } as any;

    const { graph } = createGenerationSubgraph(deps);
    const state = await (graph.invoke as any)({
      sessionId: "sess_test", userMessage: "hello",
      promptContext: { systemPrompt: "[SYSTEM]", conversationHistory: [] },
      session: { sessionId: "sess_test", characterId: "zuo_ran", continuityScope: "main", continuityFamily: "main_world", mode: "canonical_live", memoryNamespace: "main" },
      characterContext: {
        characterDefaults: { character_id: "zuo_ran", name: "Zuo Ran", safe_deflection: "I am not sure." },
        personaOverlay: { max_nsfw_level: "none", escalation_rule: "", out_of_scope_chapter_behavior: "" },
             overlayId: "main", voiceHints: "formal, restrained",
      },
    });

    assert.ok(state.generationResult, "generationResult should be produced even on tool loop error");
    assert.strictEqual((state.generationResult as any).content, "Safe deflection.");
    assert.strictEqual((state.generationResult as any).wasDeflected, true);
  });

  it("preserves toolLoopExceeded: true in errors when ToolLoopExceededError is thrown", async () => {
    const deps = makeMinDeps();
    deps.generateDraftFn = async function* () {
      throw Object.assign(new Error("Tool loop"), { name: "ToolLoopExceededError" });
    } as any;
    deps.safeDeflectionFn = async function* () {
      return { content: "Safe deflection.", wasDeflected: true, wasRewritten: false, inputTokens: 0, outputTokens: 0, validatorResult: {} } as any;
    } as any;

    const { graph } = createGenerationSubgraph(deps);
    const state = await (graph.invoke as any)({
      sessionId: "sess_test", userMessage: "hello",
      promptContext: { systemPrompt: "[SYSTEM]", conversationHistory: [] },
      session: { sessionId: "sess_test", characterId: "zuo_ran", continuityScope: "main", continuityFamily: "main_world", mode: "canonical_live", memoryNamespace: "main" },
      characterContext: {
        characterDefaults: { character_id: "zuo_ran", name: "Zuo Ran", safe_deflection: "I am not sure." },
        personaOverlay: { max_nsfw_level: "none", escalation_rule: "", out_of_scope_chapter_behavior: "" },
             overlayId: "main", voiceHints: "formal, restrained",
      },
    });

    // toolLoopExceeded must survive Zod schema normalization
    assert.ok(state.errors, "errors should exist");
    const genError = state.errors.find((e: any) => e.stage === "generateDraft");
    assert.ok(genError, "generateDraft error should be present");
    assert.strictEqual((genError as any).toolLoopExceeded, true, "toolLoopExceeded must be preserved in errors");
    // Routing: toolLoopExceeded should route to safeDeflection, not errorSink
    assert.ok(state.generationResult, "generationResult should be produced via safeDeflection");
    assert.strictEqual((state.generationResult as any).wasDeflected, true);
  });

  it("non-tool-loop generation errors route to errorSink and produce no generationResult", async () => {
    const deps = makeMinDeps();
    deps.generateDraftFn = async function* () {
      throw new Error("Network failure");
    } as any;

    const { graph } = createGenerationSubgraph(deps);
    const state = await (graph.invoke as any)({
      sessionId: "sess_test", userMessage: "hello",
      promptContext: { systemPrompt: "[SYSTEM]", conversationHistory: [] },
      session: { sessionId: "sess_test", characterId: "zuo_ran", continuityScope: "main", continuityFamily: "main_world", mode: "canonical_live", memoryNamespace: "main" },
      characterContext: {
        characterDefaults: { character_id: "zuo_ran", name: "Zuo Ran", safe_deflection: "I am not sure." },
        personaOverlay: { max_nsfw_level: "none", escalation_rule: "", out_of_scope_chapter_behavior: "" },
             overlayId: "main", voiceHints: "formal, restrained",
      },
    });

    // Non-tool-loop errors are fatal �?no generationResult
    assert.ok(state.errors, "errors should exist");
    const genError = state.errors.find((e: any) => e.stage === "generateDraft");
    assert.ok(genError, "generateDraft error should be present");
    assert.strictEqual((genError as any).toolLoopExceeded, false, "non-tool-loop errors must have toolLoopExceeded=false");
    // Fatal error: routing to errorSink, no generationResult
    assert.strictEqual(state.generationResult, undefined, "fatal generation errors must NOT produce generationResult");
    // The error should still carry the original message
    assert.ok((genError as any).message.includes("Network failure"));
  });

  it("graph validation receives meaningful recentContext and canon narrative from promptContext", async () => {
    let receivedValidatorInput: any = null;
    const deps = makeMinDeps();
    deps.validateDraftFn = (async (draft: string, vi: any) => {
      receivedValidatorInput = vi;
      return { in_character: true, canon_consistent: true, session_state_consistent: true, nsfw_within_bounds: true, issues: [], needs_rewrite: false };
    }) as any;

    const { graph } = createGenerationSubgraph(deps);
    await (graph.invoke as any)({
      sessionId: "sess_test",
      userMessage: "What happened in chapter 3?",
      promptContext: {
        systemPrompt: "[SYSTEM]\n你是左然",
        conversationHistory: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there" },
        ],
        retrievedCanonNarrative: "Chapter 3: Zuo Ran visited the ancient temple...",
        selectedMemorySources: [{ source: "interactive_memory", relevance: "useful", usageInstruction: "use_subtly" }],
      },
      session: { sessionId: "sess_test", characterId: "zuo_ran", continuityScope: "main", continuityFamily: "main_world", mode: "canonical_live", memoryNamespace: "main" },
      characterContext: {
        characterDefaults: { character_id: "zuo_ran", name: "Zuo Ran", safe_deflection: "I am not sure." },
        personaOverlay: { max_nsfw_level: "none", escalation_rule: "", out_of_scope_chapter_behavior: "" },
             overlayId: "main", voiceHints: "formal, restrained",
      },
    });

    assert.ok(receivedValidatorInput, "validateDraftFn should have been called");
    assert.equal(receivedValidatorInput.characterId, "zuo_ran");
    assert.equal(receivedValidatorInput.continuityScope, "main");
    assert.equal(receivedValidatorInput.mode, "canonical_live");
    assert.ok(receivedValidatorInput.recentContext.includes("Hello"), "recentContext should contain conversation history");
    assert.ok(receivedValidatorInput.recentContext.includes("What happened in chapter 3?"), "recentContext should contain user message");
    assert.equal(receivedValidatorInput.retrievedCanonNarrative, "Chapter 3: Zuo Ran visited the ancient temple...");
    assert.equal(receivedValidatorInput.wasCanonInjected, true);
    assert.ok(Array.isArray(receivedValidatorInput.selectedMemorySources));
    assert.equal(receivedValidatorInput.selectedMemorySources.length, 1);
    assert.ok("signal" in receivedValidatorInput);
  });

  it("graph validation wasCanonInjected is false when canon narrative is short or empty", async () => {
    let receivedValidatorInput: any = null;
    const deps = makeMinDeps();
    deps.validateDraftFn = (async (draft: string, vi: any) => {
      receivedValidatorInput = vi;
      return { in_character: true, canon_consistent: true, session_state_consistent: true, nsfw_within_bounds: true, issues: [], needs_rewrite: false };
    }) as any;

    const { graph } = createGenerationSubgraph(deps);
    await (graph.invoke as any)({
      sessionId: "sess_test",
      userMessage: "Hi",
      promptContext: {
        systemPrompt: "[SYSTEM]\n你是左然",
        conversationHistory: [],
        retrievedCanonNarrative: "Short",
        selectedMemorySources: [],
      },
      session: { sessionId: "sess_test", characterId: "zuo_ran", continuityScope: "main", continuityFamily: "main_world", mode: "canonical_live", memoryNamespace: "main" },
      characterContext: {
        characterDefaults: { character_id: "zuo_ran", name: "Zuo Ran", safe_deflection: "I am not sure." },
        personaOverlay: { max_nsfw_level: "none", escalation_rule: "", out_of_scope_chapter_behavior: "" },
             overlayId: "main", voiceHints: "formal, restrained",
      },
    });

    assert.ok(receivedValidatorInput, "validateDraftFn should have been called");
    assert.equal(receivedValidatorInput.wasCanonInjected, false, "wasCanonInjected should be false for short canon");
    assert.equal(receivedValidatorInput.retrievedCanonNarrative, "Short");
    assert.deepEqual(receivedValidatorInput.selectedMemorySources, []);
  });

  it("graph validation recentContext falls back to '(none)' when conversationHistory is empty", async () => {
    let receivedValidatorInput: any = null;
    const deps = makeMinDeps();
    deps.validateDraftFn = (async (draft: string, vi: any) => {
      receivedValidatorInput = vi;
      return { in_character: true, canon_consistent: true, session_state_consistent: true, nsfw_within_bounds: true, issues: [], needs_rewrite: false };
    }) as any;

    const { graph } = createGenerationSubgraph(deps);
    await (graph.invoke as any)({
      sessionId: "sess_test",
      userMessage: "Hi",
      promptContext: {
        systemPrompt: "[SYSTEM]\n你是左然",
        conversationHistory: [],
      },
      session: { sessionId: "sess_test", characterId: "zuo_ran", continuityScope: "main", continuityFamily: "main_world", mode: "canonical_live", memoryNamespace: "main" },
      characterContext: {
        characterDefaults: { character_id: "zuo_ran", name: "Zuo Ran", safe_deflection: "I am not sure." },
        personaOverlay: { max_nsfw_level: "none", escalation_rule: "", out_of_scope_chapter_behavior: "" },
             overlayId: "main", voiceHints: "formal, restrained",
      },
    });

    assert.ok(receivedValidatorInput, "validateDraftFn should have been called");
    assert.ok(receivedValidatorInput.recentContext.includes("(none)"), "recentContext should show (none) when no conversation history");
  });

  it("graph and direct-path validator contexts match for the same fake input", async () => {
    const fakeSession = { characterId: "zuo_ran", continuityScope: "main", mode: "canonical_live" };
    const fakePersonaOverlay = { max_nsfw_level: "moderate", escalation_rule: "escalate", out_of_scope_chapter_behavior: "deflect" };
    const fakePromptContext = {
      systemPrompt: "[SYSTEM]\n你是左然",
      conversationHistory: [
        { role: "user" as const, content: "Earlier message" },
        { role: "assistant" as const, content: "Earlier reply" },
      ],
      retrievedCanonNarrative: "Chapter 5: A long canon narrative that exceeds thirty characters easily.",
      selectedMemorySources: [{ source: "interactive_memory", relevance: "useful", usageInstruction: "use_subtly" }],
    };
    const fakeUserMessage = "What about chapter 5?";
    const fakeSignal = new AbortController().signal;

    // Build the direct-path context directly
    const directCtx = buildValidatorContext({
      session: fakeSession as any,
      personaOverlay: fakePersonaOverlay,
      promptContext: fakePromptContext,
      userMessage: fakeUserMessage,
      signal: fakeSignal,
    });

    // Build the graph-path context via the generation subgraph
    let graphCtx: any = null;
    const deps = makeMinDeps();
    deps.validateDraftFn = (async (draft: string, vi: any) => {
      graphCtx = vi;
      return { in_character: true, canon_consistent: true, session_state_consistent: true, nsfw_within_bounds: true, issues: [], needs_rewrite: false };
    }) as any;

    const { graph } = createGenerationSubgraph(deps);
    await (graph.invoke as any)({
      sessionId: "sess_test",
      userMessage: fakeUserMessage,
      promptContext: fakePromptContext,
      session: { sessionId: "sess_test", ...fakeSession, continuityFamily: "main_world", memoryNamespace: "main" } as any,
      characterContext: {
        characterDefaults: { character_id: "zuo_ran", name: "Zuo Ran", safe_deflection: "I am not sure." },
        personaOverlay: fakePersonaOverlay,
        overlayId: "main",
        voiceHints: "formal, restrained",
      },
      _signal: fakeSignal,
    });

    assert.ok(graphCtx, "graph validation should have been called");
    // Compare every field that the direct path produces
    assert.equal(graphCtx.characterId, directCtx.characterId, "characterId should match");
    assert.equal(graphCtx.continuityScope, directCtx.continuityScope, "continuityScope should match");
    assert.equal(graphCtx.mode, directCtx.mode, "mode should match");
    assert.equal(graphCtx.maxNsfwLevel, directCtx.maxNsfwLevel, "maxNsfwLevel should match");
    assert.equal(graphCtx.escalationRule, directCtx.escalationRule, "escalationRule should match");
    assert.equal(graphCtx.outOfScopeChapterBehavior, directCtx.outOfScopeChapterBehavior, "outOfScopeChapterBehavior should match");
    assert.equal(graphCtx.recentContext, directCtx.recentContext, "recentContext should match");
    assert.equal(graphCtx.retrievedCanonNarrative, directCtx.retrievedCanonNarrative, "retrievedCanonNarrative should match");
    assert.equal(graphCtx.wasCanonInjected, directCtx.wasCanonInjected, "wasCanonInjected should match");
    assert.deepEqual(graphCtx.selectedMemorySources, directCtx.selectedMemorySources, "selectedMemorySources should match");
    assert.equal(graphCtx.signal, directCtx.signal, "signal should match");
  });

  it("rewrite toolLoopExceeded error preserves toolLoopExceeded: true and routes to safeDeflection", async () => {
    const deps = makeMinDeps();
    // First pass: needs rewrite (issues is string[] per ValidationResult)
    deps.validateDraftFn = async () => ({ in_character: true, canon_consistent: true, session_state_consistent: true, nsfw_within_bounds: true, issues: ["bad_attribution"], needs_rewrite: true }) as any;
    // Rewrite throws ToolLoopExceededError
    deps.rewriteDraftFn = async function* () {
      throw Object.assign(new Error("Rewrite tool loop"), { name: "ToolLoopExceededError" });
    } as any;
    deps.safeDeflectionFn = async function* () {
      return { content: "Rewrite safe deflection.", wasDeflected: true, wasRewritten: false, inputTokens: 0, outputTokens: 0, validatorResult: {} } as any;
    } as any;

    const { graph } = createGenerationSubgraph(deps);
    const state = await (graph.invoke as any)({
      sessionId: "sess_test", userMessage: "hello",
      promptContext: { systemPrompt: "[SYSTEM]", conversationHistory: [] },
      session: { sessionId: "sess_test", characterId: "zuo_ran", continuityScope: "main", continuityFamily: "main_world", mode: "canonical_live", memoryNamespace: "main" },
      characterContext: {
        characterDefaults: { character_id: "zuo_ran", name: "Zuo Ran", safe_deflection: "I am not sure." },
        personaOverlay: { max_nsfw_level: "none", escalation_rule: "", out_of_scope_chapter_behavior: "" },
             overlayId: "main", voiceHints: "formal, restrained",
      },
    });

    assert.ok(state.errors, "errors should exist");
    const rwError = state.errors.find((e: any) => e.stage === "runRewriteDraft");
    assert.ok(rwError, "runRewriteDraft error should be present");
    assert.strictEqual((rwError as any).toolLoopExceeded, true, "rewrite toolLoopExceeded must be preserved");
    assert.ok(state.generationResult, "generationResult should be produced via safeDeflection from rewrite tool loop");
    assert.strictEqual((state.generationResult as any).wasDeflected, true);
  });

  it("propagates canonTruthMode from promptContext to validator input via subgraph", async () => {
    let receivedCanonTruthMode: string | undefined;
    const deps = makeMinDeps();
    deps.validateDraftFn = (async (_draft: string, vi: any) => {
      receivedCanonTruthMode = vi.canonTruthMode;
      return { in_character: true, canon_consistent: true, session_state_consistent: true, nsfw_within_bounds: true, issues: [], needs_rewrite: false };
    }) as any;

    const { graph } = createGenerationSubgraph(deps);
    await (graph.invoke as any)({
      sessionId: "sess_test",
      userMessage: "还记得那封信吗？",
      promptContext: {
        systemPrompt: "[SYSTEM]\n你是左然",
        conversationHistory: [],
        retrievedCanonNarrative: "章节背景：秋季结束前我们又去了回枫河。",
        selectedMemorySources: [{ source: "canon_fact", relevance: "required", usageInstruction: "must_use" }],
        canonTruthMode: "strict_canon_recall",
      },
      session: { sessionId: "sess_test", characterId: "zuo_ran", continuityScope: "main", continuityFamily: "main_world", mode: "canonical_live", memoryNamespace: "main" } as any,
      characterContext: {
        characterDefaults: { character_id: "zuo_ran", name: "Zuo Ran", safe_deflection: "..." },
        personaOverlay: { max_nsfw_level: "none", escalation_rule: "", out_of_scope_chapter_behavior: "" },
        overlayId: "main", voiceHints: "formal",
      },
      draft: { content: "test draft" },
    } as any);

    assert.equal(receivedCanonTruthMode, "strict_canon_recall",
      "canonTruthMode should propagate from promptContext through subgraph to validator input");
  });
});

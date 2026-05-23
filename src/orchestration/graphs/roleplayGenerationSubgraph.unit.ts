import { describe, it } from "node:test";
import assert from "node:assert";
import { createGenerationSubgraph } from "./roleplayGenerationSubgraph";
import type { RoleplayGraphDeps } from "./roleplayGraph";

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
    const state = await graph.invoke({
      sessionId: "sess_test",
      userMessage: "hello",
      promptContext: { systemPrompt: "[SYSTEM]\nYou are Zuo Ran.", conversationHistory: [] },
      session: { sessionId: "sess_test", characterId: "zuo_ran", continuityScope: "main", continuityFamily: "main_world", mode: "canonical_live", memoryNamespace: "main" },
      characterContext: {
        characterDefaults: { character_id: "zuo_ran", name: "Zuo Ran", safe_deflection: "I am not sure." },
        personaOverlay: { max_nsfw_level: "none", escalation_rule: "", out_of_scope_chapter_behavior: "" },
        voiceHints: "formal, restrained",
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
    const state = await graph.invoke({
      sessionId: "sess_test", userMessage: "hello",
      promptContext: { systemPrompt: "[SYSTEM]", conversationHistory: [] },
      session: { sessionId: "sess_test", characterId: "zuo_ran", continuityScope: "main", continuityFamily: "main_world", mode: "canonical_live", memoryNamespace: "main" },
      characterContext: {
        characterDefaults: { character_id: "zuo_ran", name: "Zuo Ran", safe_deflection: "I am not sure." },
        personaOverlay: { max_nsfw_level: "none", escalation_rule: "", out_of_scope_chapter_behavior: "" },
        voiceHints: "formal, restrained",
      },
    });

    assert.ok(state.generationResult, "generationResult should be produced even on tool loop error");
    assert.strictEqual((state.generationResult as any).content, "Safe deflection.");
    assert.strictEqual((state.generationResult as any).wasDeflected, true);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert";
import { parseEnabledFlag } from "../../config/env";
import { createRoleplayStreamFn } from "./runCharacterTurn";
import { createRoleplayGraph } from "../graphs/roleplayGraph";
import type { RoleplayGraphStreamAdapterDeps } from "../graphs/roleplayGraphStreamAdapter";
import type { PreGenerationResult } from "../graphs/roleplayPreGenerationGraph";
import type { CharacterTurnSseEvent } from "./runCharacterTurn";
import type { ChatSession } from "../../db/schema/chat";

describe("ROLEPLAY_GRAPH_STREAM_ENABLED env parsing", () => {
  it("parses flag values correctly", () => {
    const cases = [
      { name: "undefined → false", input: undefined, expected: false },
      { name: "'true' → true", input: "true", expected: true },
      { name: "'1' → true", input: "1", expected: true },
      { name: "'false' → false", input: "false", expected: false },
      { name: "'0' → false", input: "0", expected: false },
      { name: "'' → false", input: "", expected: false },
    ];
    for (const c of cases) {
      assert.strictEqual(parseEnabledFlag(c.input as any), c.expected, c.name);
    }
  });
});

function fakeSession(): ChatSession { return { sessionId: "sess_test", characterId: "zuo_ran", playerId: "p-001", mode: "canonical_live", continuityScope: "main", continuityFamily: "main_world", personaOverlayId: null, memoryNamespace: "main", pinnedTime: null, pinnedLocation: null, writebackPolicy: "full_writeback", sessionSummary: null, displayTitle: null, thinking: true, temperature: 1, deletedAt: null, createdAt: new Date(), updatedAt: new Date() }; }

function fakePreGenerationResult(): PreGenerationResult { return { session: fakeSession(), characterContext: { characterDefaults: { character_id: "zuo_ran", name: "Zuo Ran", archetype: "romantic_lead", identity: "A wandering scholar.", speech_style: { language: "Chinese", formality: "formal", emotionality: "restrained", preferred_patterns: [], avoid: [] }, core_traits: ["wise"], values: ["honesty", "loyalty"], hard_rules: ["Stay in character."], interaction_defaults: { default_continuity_scope: "main", default_emotional_baseline: "calm", default_relationship_baseline: "neutral", response_length: "medium", allows_personal_topics: "sometimes" }, safe_deflection: "I am not sure.", version: "1.0" }, overlayId: "main", personaOverlay: { overlay_id: "main", character_id: "zuo_ran", continuity_scope: "main", relationship_status: "confirmed_relationship", openness: "open", domesticity: "low", baseline_warmth: "warm", baseline_nsfw_openness: "low", max_nsfw_level: "none", escalation_rule: "", out_of_scope_chapter_behavior: "", overlay_identity: "main", tone_notes: {}, writeback_policies: {} }, voiceHints: "formal, restrained" }, resolvedContext: { derivedState: { inferredMood: "calm", inferredActivity: "conversing", conversationalStance: "neutral" }, memories: [], canonChunks: [], canonScenes: [], recentTurns: [], queryEmbedding: [], canonQueryEmbedding: [], sessionSummary: null, sessionRecall: [], structMemEntries: [], structMemEntryContextExpansions: [], structMemConsolidations: [], openThreads: [], memoryCorrections: [], latestTurnDelta: null, queryRewrite: { intent: "general", confidence: 1, segments: [], combined_for_embedding: "test", entities: [], parseOk: true, structuralParseOk: true, labelOk: true }, retrievalPlan: { intent: "general", canonMode: "skip", durableMemoryTopK: 8, sessionRecallTopK: 12, structMemEntryTopK: 16, structMemConsolidationTopK: 4, openThreadTopK: 4, broadFailOpen: false, forceOpenThreads: false, contextNeed: { needsRecentTurns: true, needsOlderSessionRecall: false, needsDurableMemory: false, needsStructMem: false, needsStructMemConsolidation: false, needsCanon: false, needsWeb: false, injectionMode: "full", reason: "test" } }, turnType: "general_roleplay" as any, isFirstUserTurn: false, recallThoughtContext: { items: [], countsBySource: {}, selectionMode: "fallback" } }, promptContext: { systemPrompt: "[SYSTEM]\n你是左然", conversationHistory: [] }, errors: undefined }; }

const minimalFakeDeps: RoleplayGraphStreamAdapterDeps = { runPreGeneration: async () => fakePreGenerationResult(), preGenerationDeps: {} as any, runGeneration: async function* () {}, persistTurn: async () => ({ persistedRoute: "roleplay_turn" as const, persisted: { userMessageId: "um-001", assistantMessageId: "am-001", assistantTurnIndex: 5, jobId: null as string | null } }), generationModelBinding: { provider: "deepseek" as const, model: "deepseek-chat" }, buildRecallThought: async () => ({ text: "" }), updateThoughts: async () => {}, traceRoleplayTurn: async () => {} };

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> { const items: T[] = []; for await (const item of gen) items.push(item); return items; }

describe("createRoleplayStreamFn", () => {
  it("routes through graph adapter when flag true, existing stream when false, and invokes pre-generation", async () => {
    // Flag true → graph adapter path
    let preGenCalled = false;
    let deps: RoleplayGraphStreamAdapterDeps = { ...minimalFakeDeps, runPreGeneration: async (input, deps) => { preGenCalled = true; return fakePreGenerationResult(); } };
    let streamFn = createRoleplayStreamFn(true, deps);
    let events = await collect(streamFn({ sessionId: "sess_test", userMessage: "hello", session: fakeSession() }));
    assert.ok(preGenCalled, "flag true — pre-generation called");
    assert.strictEqual(events.length, 0, "flag true — no events");

    // Flag false → existing stream path
    let existingPathCalled = false;
    let graphPathCalled = false;
    const fakeExistingStream = async function* (): AsyncGenerator<CharacterTurnSseEvent> { existingPathCalled = true; };
    deps = { ...minimalFakeDeps, runPreGeneration: async () => { graphPathCalled = true; return fakePreGenerationResult(); } };
    streamFn = createRoleplayStreamFn(false, deps, fakeExistingStream);
    await collect(streamFn({ sessionId: "sess_test", userMessage: "hello", session: fakeSession() }));
    assert.ok(existingPathCalled, "flag false — existing path called");
    assert.strictEqual(graphPathCalled, false, "flag false — graph not called");

    // Production stream is pre-generation/adapter based
    preGenCalled = false;
    deps = { ...minimalFakeDeps, runPreGeneration: async (input, deps) => { preGenCalled = true; return fakePreGenerationResult(); } };
    streamFn = createRoleplayStreamFn(true, deps);
    await collect(streamFn({ sessionId: "sess_test", userMessage: "hello", session: fakeSession() }));
    assert.ok(preGenCalled, "production — preGeneration called");
    assert.ok((createRoleplayGraph as any).__devSmokeOnly, "production — devSmokeOnly marker");
  });
});

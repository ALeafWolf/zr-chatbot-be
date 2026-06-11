import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadRoleplayCharacterContext, resolveRoleplayContext, buildRoleplayPromptContext, type ResolveRoleplayContextInput } from "./roleplayAdapters";
import type { CharacterDefaults, PersonaOverlayDefaults } from "../../character/characterDefaults";
import type { ChatSession } from "../../db/schema/chat";
import type { ResolvedContext } from "../context/resolveContext";
import type { PromptContext } from "../prompt/buildPromptContext";
import { env } from "../../config/env";

function fakeCharacterDefaults(overrides?: Partial<CharacterDefaults>): CharacterDefaults { return { character_id: "zuo_ran", name: "Zuo Ran", archetype: "sage", identity: "A wandering scholar.", speech_style: { language: "Chinese", formality: "formal", emotionality: "restrained", preferred_patterns: ["古典引用"], avoid: ["现代俚语"] }, core_traits: ["wise", "patient"], narrative_prose_guidelines: "Write with classical elegance.", in_character_expression: "Speak in measured tones.", emotional_core: "Deep but controlled.", values: ["knowledge", "harmony"], hard_rules: ["Stay in character."], private_habits_and_texture: ["enjoys tea", "reads scrolls"], relationship_expression: { general: "Polite and distant." }, interaction_defaults: { default_continuity_scope: "main", default_emotional_baseline: "calm", default_relationship_baseline: "neutral", response_length: "medium", allows_personal_topics: "sometimes" }, safe_deflection: "I am not sure how to respond.", version: "1.0", ...overrides }; }
function fakePersonaOverlay(): PersonaOverlayDefaults { return { overlay_id: "main", character_id: "zuo_ran", continuity_scope: "main", relationship_status: "confirmed_relationship", openness: "high", domesticity: "medium", baseline_warmth: "medium", baseline_nsfw_openness: "none", max_nsfw_level: "none", escalation_rule: "none", out_of_scope_chapter_behavior: "deflect", overlay_identity: "The bond deepens.", tone_notes: {}, writeback_policies: {} }; }
function fakeSession(overrides?: Partial<ChatSession>): ChatSession { return { sessionId: "s-001", characterId: "zuo_ran", playerId: "p-001", mode: "canonical_live", continuityScope: "main", continuityFamily: "main_world", personaOverlayId: null, memoryNamespace: "main", pinnedTime: null, pinnedLocation: null, writebackPolicy: "full_writeback", sessionSummary: null, displayTitle: null, thinking: true, temperature: 1, deletedAt: null, createdAt: new Date(), updatedAt: new Date(), ...overrides }; }
function fakeResolvedContext(overrides?: Partial<ResolvedContext>): ResolvedContext { return { memories: [], canonChunks: [], canonScenes: [], recentTurns: [], derivedState: { inferredMood: "calm", inferredActivity: "conversing", conversationalStance: "neutral" }, queryEmbedding: [0.1, 0.2, 0.3], canonQueryEmbedding: [0.1, 0.2, 0.3], sessionSummary: null, sessionRecall: [], structMemEntries: [], structMemEntryContextExpansions: [], structMemConsolidations: [], openThreads: [], memoryCorrections: [], latestTurnDelta: null, queryRewrite: { intent: "general", confidence: 0.9, segments: [], combined_for_embedding: "chat about the day", entities: [], hypothetical: undefined, structuralParseOk: true, labelOk: true, parseOk: true }, retrievalPlan: { intent: "general", canonMode: "skip", durableMemoryTopK: 8, sessionRecallTopK: 12, structMemEntryTopK: 16, structMemConsolidationTopK: 4, openThreadTopK: 4, broadFailOpen: false, forceOpenThreads: false, contextNeed: { needsRecentTurns: true, needsOlderSessionRecall: false, needsDurableMemory: false, needsStructMem: false, needsStructMemConsolidation: false, needsCanon: false, needsWeb: false, structMemReason: "none", injectionMode: "skip", reason: "casual_conversation" } }, turnType: "general_roleplay", motifSignal: undefined, motifProbe: undefined, rerankOutput: null, recallThoughtContext: { items: [], countsBySource: {}, selectionMode: "fallback" }, isFirstUserTurn: false, ...overrides }; }
function fakePromptContext(overrides?: Partial<PromptContext>): PromptContext { return { systemPrompt: "[SYSTEM]\nTest.", conversationHistory: [], ...overrides }; }

describe("loadRoleplayCharacterContext", () => {
  it("uses personaOverlayId when available, falls back to continuityScope, returns voiceHints and defaults", async () => {
    let r = await loadRoleplayCharacterContext({ session: fakeSession({ personaOverlayId: "au_custom" }) }, { loadCharacterDefaults: () => fakeCharacterDefaults(), loadPersonaOverlay: (id) => { assert.equal(id, "au_custom", "load — custom overlay"); return fakePersonaOverlay(); } });
    assert.equal(r.overlayId, "au_custom", "custom overlay id");

    let capturedOverlayId: string | undefined;
    r = await loadRoleplayCharacterContext({ session: fakeSession({ personaOverlayId: null, continuityScope: "au_modern" }) }, { loadCharacterDefaults: () => fakeCharacterDefaults(), loadPersonaOverlay: (id) => { capturedOverlayId = id; return fakePersonaOverlay(); } });
    assert.equal(capturedOverlayId, "au_modern", "fallback — captured overlayId");
    assert.equal(r.overlayId, "au_modern", "fallback — result overlayId");

    r = await loadRoleplayCharacterContext({ session: fakeSession() }, { loadCharacterDefaults: () => fakeCharacterDefaults({ speech_style: { ...fakeCharacterDefaults().speech_style, formality: "intimate", emotionality: "affectionate" } }), loadPersonaOverlay: () => fakePersonaOverlay() });
    assert.ok(r.voiceHints.includes("intimate"), "voiceHints — intimate");
    assert.ok(r.voiceHints.includes("affectionate"), "voiceHints — affectionate");

    r = await loadRoleplayCharacterContext({ session: fakeSession() }, { loadCharacterDefaults: () => fakeCharacterDefaults({ name: "Test Bot" }), loadPersonaOverlay: () => fakePersonaOverlay() });
    assert.equal(r.characterDefaults.name, "Test Bot", "defaults — name");
    assert.equal(r.personaOverlay.overlay_id, "main", "defaults — overlay_id");
  });
});

describe("resolveRoleplayContext", () => {
  it("passes session, userMessage, characterDefaults through to injected resolver", async () => {
    const cd = fakeCharacterDefaults();
    const session = fakeSession();
    const fakeContext = fakeResolvedContext();
    let capturedInput: ResolveRoleplayContextInput | undefined;
    const result = await resolveRoleplayContext({ session, userMessage: "hello", characterDefaults: cd }, { resolveContext: (async (input: ResolveRoleplayContextInput) => { capturedInput = input; return fakeContext; }) as any });
    assert.equal(capturedInput!.session, session, "session passthrough");
    assert.equal(capturedInput!.userMessage, "hello", "userMessage passthrough");
    assert.equal(capturedInput!.characterDefaults, cd, "cd passthrough");
    assert.equal(result, fakeContext, "result passthrough");
  });
});

describe("buildRoleplayPromptContext", () => {
  it("maps resolvedContext fields to prompt builder input", async () => {
    const cd = fakeCharacterDefaults();
    const po = fakePersonaOverlay();
    const session = fakeSession();
    const resolved = fakeResolvedContext();
    let capturedInput: Record<string, unknown> | undefined;
    const result = await buildRoleplayPromptContext({ characterDefaults: cd, personaOverlay: po, session, resolvedContext: resolved, userMessage: "hello" }, { buildPromptContext: (async (input: Record<string, unknown>) => { capturedInput = input; return fakePromptContext(); }) as any });
    assert.ok(capturedInput, "input captured");
    assert.equal(capturedInput!.characterDefaults, cd, "cd");
    assert.equal(capturedInput!.personaOverlay, po, "po");
    assert.equal(capturedInput!.session, session, "session");
    assert.equal(capturedInput!.userMessage, "hello", "userMessage");
    assert.equal(capturedInput!.derivedState, resolved.derivedState, "derivedState");
    assert.equal(capturedInput!.memories, resolved.memories, "memories");
    assert.equal(capturedInput!.canonChunks, resolved.canonChunks, "canonChunks");
    assert.equal(capturedInput!.canonScenes, resolved.canonScenes, "canonScenes");
    assert.equal(capturedInput!.memoryRerank, resolved.rerankOutput, "rerankOutput");
    assert.equal(capturedInput!.queryRewrite, resolved.queryRewrite, "queryRewrite");
    assert.deepEqual(result, fakePromptContext(), "result");
  });

  it("F16: fresh session adapter path — resolveEmotionalRenderInputs computes scope bands", async () => {
    const savedRender = (env as any).EMOTIONAL_RENDER_ENABLED;
    const savedEngine = (env as any).EMOTIONAL_ENGINE_ENABLED;
    try {
      (env as any).EMOTIONAL_RENDER_ENABLED = true;
      (env as any).EMOTIONAL_ENGINE_ENABLED = true;

      const cd: CharacterDefaults = {
        ...fakeCharacterDefaults(),
        emotional_axes: {
          connection: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
          valence: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
          arousal: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
          restraint: { baseline: 0.7, driftRate: 0.02, min: -1, max: 1 },
        },
        emotional_axes_baseline_by_scope: {
          main_relationship: { connection: 0.15, valence: 0.05, arousal: 0.0, restraint: 0.7 },
        },
      };

      const session = fakeSession({ continuityScope: "main_relationship" });
      const resolved = fakeResolvedContext({ sessionStateRow: null });

      let capturedInput: Record<string, unknown> | undefined;
      await buildRoleplayPromptContext(
        { characterDefaults: cd, personaOverlay: fakePersonaOverlay(), session, resolvedContext: resolved, userMessage: "hello" },
        { buildPromptContext: (async (input: Record<string, unknown>) => { capturedInput = input; return fakePromptContext(); }) as any },
      );

      assert.ok(capturedInput, "adapter called buildPromptContext");
      // Assert computed emotionalAxisBands from fresh-session scope baselines
      const bands = capturedInput!.emotionalAxisBands as Record<string, string>;
      assert.ok(bands, "emotionalAxisBands present");
      assert.equal(bands.restraint, "high", "main_relationship restraint 0.7 > 0.65 → high");
      assert.equal(bands.connection, "mid", "main_relationship connection 0.15 centered → mid");
      assert.equal(bands.valence, "mid", "main_relationship valence 0.05 centered → mid");
      assert.equal(bands.arousal, "mid", "main_relationship arousal 0 centered → mid");

      // Assert synthetic trace and empty history
      const trace = capturedInput!.emotionalAxisLastTrace as Record<string, unknown>;
      assert.ok(trace, "emotionalAxisLastTrace present");
      assert.deepEqual((trace as any).couplingsFired, []);
    } finally {
      (env as any).EMOTIONAL_RENDER_ENABLED = savedRender;
      (env as any).EMOTIONAL_ENGINE_ENABLED = savedEngine;
    }
  });
});

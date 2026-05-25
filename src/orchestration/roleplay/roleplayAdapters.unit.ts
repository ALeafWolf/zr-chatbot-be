import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  voiceHintsFrom,
  loadRoleplayCharacterContext,
  resolveRoleplayContext,
  buildRoleplayPromptContext,
  type LoadRoleplayCharacterContextInput,
  type ResolveRoleplayContextInput,
  type BuildRoleplayPromptContextInput,
} from "./roleplayAdapters";
import type { CharacterDefaults, PersonaOverlayDefaults } from "../../character/characterDefaults";
import type { ChatSession } from "../../db/schema/chat";
import type { ResolvedContext } from "../context/resolveContext";
import type { PromptContext } from "../prompt/buildPromptContext";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function fakeCharacterDefaults(
  overrides?: Partial<CharacterDefaults>,
): CharacterDefaults {
  return {
    character_id: "zuo_ran",
    name: "Zuo Ran",
    archetype: "sage",
    identity: "A wandering scholar.",
    speech_style: {
      language: "Chinese",
      formality: "formal",
      emotionality: "restrained",
      preferred_patterns: ["古典引用"],
      avoid: ["现代俚语"],
    },
    core_traits: ["wise", "patient"],
    narrative_prose_guidelines: "Write with classical elegance.",
    in_character_expression: "Speak in measured tones.",
    emotional_core: "Deep but controlled.",
    values: ["knowledge", "harmony"],
    hard_rules: ["Stay in character."],
    private_habits_and_texture: ["enjoys tea", "reads scrolls"],
    relationship_expression: {
      general: "Polite and distant.",
    },
    interaction_defaults: {
      default_continuity_scope: "main",
      default_emotional_baseline: "calm",
      default_relationship_baseline: "neutral",
      response_length: "medium",
      allows_personal_topics: "sometimes",
    },
    safe_deflection: "I am not sure how to respond.",
    version: "1.0",
    ...overrides,
  };
}

function fakePersonaOverlay(): PersonaOverlayDefaults {
  return {
    overlay_id: "main",
    character_id: "zuo_ran",
    continuity_scope: "main",
    relationship_status: "confirmed_relationship",
    openness: "high",
    domesticity: "medium",
    baseline_warmth: "medium",
    baseline_nsfw_openness: "none",
    max_nsfw_level: "none",
    escalation_rule: "none",
    out_of_scope_chapter_behavior: "deflect",
    overlay_identity: "The bond deepens.",
    tone_notes: {},
    writeback_policies: {},
  };
}

function fakeSession(overrides?: Partial<ChatSession>): ChatSession {
  return {
    sessionId: "s-001",
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
    ...overrides,
  };
}

function fakeResolvedContext(
  overrides?: Partial<ResolvedContext>,
): ResolvedContext {
  return {
    memories: [],
    canonChunks: [],
    canonScenes: [],
    recentTurns: [],
    derivedState: {
      inferredMood: "calm",
      inferredActivity: "conversing",
      conversationalStance: "neutral",
    },
    queryEmbedding: [0.1, 0.2, 0.3],
    canonQueryEmbedding: [0.1, 0.2, 0.3],
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
      combined_for_embedding: "chat about the day",
      entities: [],
      hypothetical: undefined,
      structuralParseOk: true,
      labelOk: true,
      parseOk: true,
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
        reason: "casual_conversation",
      },
    },
    turnType: "general_roleplay",
    motifSignal: undefined,
    motifProbe: undefined,
    rerankOutput: null,
    recallThoughtContext: { items: [], countsBySource: {}, selectionMode: "fallback" },
    isFirstUserTurn: false,
    ...overrides,
  };
}

function fakePromptContext(overrides?: Partial<PromptContext>): PromptContext {
  return {
    systemPrompt: "[SYSTEM]\nTest.",
    conversationHistory: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// voiceHintsFrom
// ---------------------------------------------------------------------------

describe("voiceHintsFrom", () => {
  it("joins formality, emotionality, and preferred patterns with Chinese comma", () => {
    const cd = fakeCharacterDefaults({
      speech_style: {
        ...fakeCharacterDefaults().speech_style,
        formality: "casual",
        emotionality: "warm",
        preferred_patterns: ["口语化表达", "短句"],
      },
    });

    const result = voiceHintsFrom(cd);
    assert.equal(result, "casual，warm，口语化表达，短句");
  });

  it("handles empty preferred_patterns", () => {
    const cd = fakeCharacterDefaults({
      speech_style: {
        ...fakeCharacterDefaults().speech_style,
        formality: "formal",
        emotionality: "restrained",
        preferred_patterns: [],
      },
    });

    const result = voiceHintsFrom(cd);
    assert.equal(result, "formal，restrained");
  });

  it("handles undefined preferred_patterns gracefully", () => {
    const cd = fakeCharacterDefaults({
      speech_style: {
        ...fakeCharacterDefaults().speech_style,
        formality: "neutral",
        emotionality: "neutral",
        preferred_patterns: undefined as unknown as string[],
      },
    });

    const result = voiceHintsFrom(cd);
    assert.equal(result, "neutral，neutral");
  });
});

// ---------------------------------------------------------------------------
// loadRoleplayCharacterContext
// ---------------------------------------------------------------------------

describe("loadRoleplayCharacterContext", () => {
  it("uses personaOverlayId when available", async () => {
    const session = fakeSession({ personaOverlayId: "au_custom" });
    const fakeLoadDefaults = () => fakeCharacterDefaults();
    const fakeLoadOverlay = (id: string) => {
      assert.equal(id, "au_custom");
      return fakePersonaOverlay();
    };

    const result = await loadRoleplayCharacterContext(
      { session },
      {
        loadCharacterDefaults: fakeLoadDefaults,
        loadPersonaOverlay: fakeLoadOverlay,
      },
    );

    assert.equal(result.overlayId, "au_custom");
  });

  it("falls back to continuityScope when personaOverlayId is null", async () => {
    const session = fakeSession({
      personaOverlayId: null,
      continuityScope: "au_modern",
    });
    let capturedOverlayId: string | undefined;
    const fakeLoadDefaults = () => fakeCharacterDefaults();
    const fakeLoadOverlay = (id: string) => {
      capturedOverlayId = id;
      return fakePersonaOverlay();
    };

    const result = await loadRoleplayCharacterContext(
      { session },
      {
        loadCharacterDefaults: fakeLoadDefaults,
        loadPersonaOverlay: fakeLoadOverlay,
      },
    );

    assert.equal(capturedOverlayId, "au_modern");
    assert.equal(result.overlayId, "au_modern");
  });

  it("returns voiceHints from character defaults", async () => {
    const session = fakeSession();
    const fakeLoadDefaults = () =>
      fakeCharacterDefaults({
        speech_style: {
          ...fakeCharacterDefaults().speech_style,
          formality: "intimate",
          emotionality: "affectionate",
        },
      });
    const fakeLoadOverlay = () => fakePersonaOverlay();

    const result = await loadRoleplayCharacterContext(
      { session },
      {
        loadCharacterDefaults: fakeLoadDefaults,
        loadPersonaOverlay: fakeLoadOverlay,
      },
    );

    assert.ok(result.voiceHints.includes("intimate"));
    assert.ok(result.voiceHints.includes("affectionate"));
  });

  it("returns characterDefaults and personaOverlay", async () => {
    const session = fakeSession();
    const fakeLoadDefaults = () => fakeCharacterDefaults({ name: "Test Bot" });
    const fakeLoadOverlay = () => fakePersonaOverlay();

    const result = await loadRoleplayCharacterContext(
      { session },
      {
        loadCharacterDefaults: fakeLoadDefaults,
        loadPersonaOverlay: fakeLoadOverlay,
      },
    );

    assert.equal(result.characterDefaults.name, "Test Bot");
    assert.equal(result.personaOverlay.overlay_id, "main");
  });
});

// ---------------------------------------------------------------------------
// resolveRoleplayContext
// ---------------------------------------------------------------------------

describe("resolveRoleplayContext", () => {
  it("passes session, userMessage, characterDefaults through to injected resolver", async () => {
    const cd = fakeCharacterDefaults();
    const session = fakeSession();
    const fakeContext = fakeResolvedContext();

    let capturedInput: ResolveRoleplayContextInput | undefined;
    const fakeResolver = async (
      input: ResolveRoleplayContextInput,
    ): Promise<ResolvedContext> => {
      capturedInput = input;
      return fakeContext;
    };

    const result = await resolveRoleplayContext(
      { session, userMessage: "hello", characterDefaults: cd },
      { resolveContext: fakeResolver as typeof resolveRoleplayContext extends (...args: unknown[]) => unknown ? never : never },
    );

    assert.equal(capturedInput!.session, session);
    assert.equal(capturedInput!.userMessage, "hello");
    assert.equal(capturedInput!.characterDefaults, cd);
    assert.equal(result, fakeContext);
  });
});

// ---------------------------------------------------------------------------
// buildRoleplayPromptContext
// ---------------------------------------------------------------------------

describe("buildRoleplayPromptContext", () => {
  it("maps resolvedContext fields to prompt builder input", async () => {
    const cd = fakeCharacterDefaults();
    const po = fakePersonaOverlay();
    const session = fakeSession();
    const resolved = fakeResolvedContext();

    let capturedInput: Record<string, unknown> | undefined;
    const fakeBuilder = async (input: Record<string, unknown>) => {
      capturedInput = input;
      return fakePromptContext();
    };

    const result = await buildRoleplayPromptContext(
      {
        characterDefaults: cd,
        personaOverlay: po,
        session,
        resolvedContext: resolved,
        userMessage: "hello",
      },
      {
        buildPromptContext: fakeBuilder as unknown as typeof buildRoleplayPromptContext extends (...args: unknown[]) => unknown ? never : never,
      },
    );

    assert.ok(capturedInput);
    assert.equal(capturedInput!.characterDefaults, cd);
    assert.equal(capturedInput!.personaOverlay, po);
    assert.equal(capturedInput!.session, session);
    assert.equal(capturedInput!.userMessage, "hello");
    // Verify resolvedContext fields are mapped
    assert.equal(capturedInput!.derivedState, resolved.derivedState);
    assert.equal(capturedInput!.memories, resolved.memories);
    assert.equal(capturedInput!.canonChunks, resolved.canonChunks);
    assert.equal(capturedInput!.canonScenes, resolved.canonScenes);
    assert.equal(capturedInput!.memoryRerank, resolved.rerankOutput);
    assert.equal(capturedInput!.queryRewrite, resolved.queryRewrite);
    assert.deepEqual(result, fakePromptContext());
  });
});

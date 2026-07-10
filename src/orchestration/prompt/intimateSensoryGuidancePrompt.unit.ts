import assert from "node:assert/strict";
import test from "node:test";
import { env } from "../../config/env";
import { buildPromptContext } from "./buildPromptContext";
import { INTIMATE_SENSORY_GUIDANCE_BLOCK } from "./intimateSensoryGuidance";

const characterDefaults = {
  name: "Test Character",
  identity: "A test character.",
  hard_rules: ["Stay in character."],
  core_traits: [],
  narrative_prose_guidelines: "",
  speech_style: { language: "Chinese", formality: "formal", emotionality: "restrained", preferred_patterns: [], avoid: [] },
  in_character_expression: "",
  emotional_core: "",
  values: [],
  private_habits_and_texture: [],
  relationship_expression: { general: "" },
  interaction_defaults: { default_continuity_scope: "main", default_emotional_baseline: "calm", default_relationship_baseline: "neutral" },
} as any;

const personaOverlay = {
  continuity_scope: "main",
  relationship_status: "confirmed_relationship",
  baseline_warmth: "medium",
  baseline_nsfw_openness: "none",
  max_nsfw_level: "none",
  escalation_rule: "none",
  out_of_scope_chapter_behavior: "deflect",
  overlay_identity: "",
} as any;

const session = {
  sessionId: "s1", characterId: "c1", playerId: "p1", mode: "canonical_live",
  continuityScope: "main", continuityFamily: "main_world", personaOverlayId: null,
  memoryNamespace: "main", pinnedTime: null, pinnedLocation: null,
  writebackPolicy: "full_writeback", sessionSummary: null, displayTitle: null,
  thinking: true, temperature: 1, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
} as any;

function baseInput() {
  return {
    characterDefaults,
    personaOverlay,
    session,
    derivedState: { inferredMood: "calm", inferredActivity: "in_conversation", conversationalStance: "attentive" },
    memories: [],
    canonChunks: [],
    recentTurns: [],
    userMessage: "hello",
  };
}

const intimateBands = { connection: "mid" as const, valence: "mid" as const, arousal: "high" as const, restraint: "mid" as const };
const nonIntimateBands = { connection: "mid" as const, valence: "mid" as const, arousal: "mid" as const, restraint: "mid" as const };

test("buildPromptContext gates intimate sensory guidance by flag and intimate mode", () => {
  const savedGuidance = (env as any).INTIMATE_SENSORY_GUIDANCE_ENABLED;
  const savedRender = (env as any).EMOTIONAL_RENDER_ENABLED;
  const savedEngine = (env as any).EMOTIONAL_ENGINE_ENABLED;
  try {
    (env as any).EMOTIONAL_RENDER_ENABLED = false;
    (env as any).EMOTIONAL_ENGINE_ENABLED = false;

    (env as any).INTIMATE_SENSORY_GUIDANCE_ENABLED = true;
    const intimatePrompt = buildPromptContext({ ...baseInput(), emotionalAxisBands: intimateBands }).systemPrompt;
    assert.ok(intimatePrompt.includes(INTIMATE_SENSORY_GUIDANCE_BLOCK), "flag-on intimate turn includes guidance");

    (env as any).INTIMATE_SENSORY_GUIDANCE_ENABLED = false;
    const flagOffPrompt = buildPromptContext({ ...baseInput(), emotionalAxisBands: intimateBands }).systemPrompt;
    assert.equal(flagOffPrompt.includes(INTIMATE_SENSORY_GUIDANCE_BLOCK), false, "flag-off intimate turn omits guidance");

    (env as any).INTIMATE_SENSORY_GUIDANCE_ENABLED = true;
    const nonIntimatePrompt = buildPromptContext({ ...baseInput(), emotionalAxisBands: nonIntimateBands }).systemPrompt;
    assert.equal(nonIntimatePrompt.includes(INTIMATE_SENSORY_GUIDANCE_BLOCK), false, "flag-on non-intimate turn omits guidance");
  } finally {
    (env as any).INTIMATE_SENSORY_GUIDANCE_ENABLED = savedGuidance;
    (env as any).EMOTIONAL_RENDER_ENABLED = savedRender;
    (env as any).EMOTIONAL_ENGINE_ENABLED = savedEngine;
  }
});

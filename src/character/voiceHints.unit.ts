import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { voiceHintsFrom } from "./voiceHints";
import type { CharacterDefaults } from "./characterDefaults";

/**
 * Minimal fake for the speech_style slice used by voiceHintsFrom.
 */
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
      preferred_patterns: ["古典措辞"],
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

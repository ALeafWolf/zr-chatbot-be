import type { CharacterDefaults } from "./characterDefaults";

/**
 * Build a compact voice-hints string from character speech-style defaults.
 * Single source of truth for both the roleplay and generation paths.
 */
export function voiceHintsFrom(characterDefaults: CharacterDefaults): string {
  const s = characterDefaults.speech_style;
  return [s.formality, s.emotionality, ...(s.preferred_patterns ?? [])].join(
    "，",
  );
}

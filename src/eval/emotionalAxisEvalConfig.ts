// ---------------------------------------------------------------------------
// emotionalAxisEvalConfig.ts — Injected eval-only emotional-axis variant config
//
// Design D7: This is an explicit injectable toggle helper, NOT env mutation.
// Set it before calling runAgentEval / eval:emotional-axis to control variant
// behavior without changing module-level env globals.
//
// All fields default to the standard full-engine/full-render behavior.
// ---------------------------------------------------------------------------

import type { EmotionalAxisVariant } from "./experimentVariants";

export interface EmotionalAxisEvalConfig {
  /** Whether the emotional engine runs (post-turn advance, couplings). */
  engineEnabled: boolean;
  /** Whether the emotional render block is injected. */
  renderEnabled: boolean;
  /** When true, pass empty couplings to the engine (no coupling effects). */
  noCoupling: boolean;
  /** When true, render emits only the band line, suppressing rule texts. */
  bandsOnly: boolean;
}

const defaultConfig: EmotionalAxisEvalConfig = {
  engineEnabled: true,
  renderEnabled: true,
  noCoupling: false,
  bandsOnly: false,
};

/**
 * The active eval-only emotional-axis variant config.
 *
 * The runner sets this before calling into the eval pipeline.
 * Decision points (postTurnMemoryGraph, buildPromptContext)
 * read from this config rather than from `env` alone.
 */
let activeConfig: EmotionalAxisEvalConfig = { ...defaultConfig };

/**
 * Get the current emotional-axis eval config.
 */
export function getEmotionalAxisEvalConfig(): EmotionalAxisEvalConfig {
  return activeConfig;
}

/**
 * Set the emotional-axis eval config for the current variant run.
 * Returns the previous config so callers can restore it.
 */
export function setEmotionalAxisEvalConfig(
  config: Partial<EmotionalAxisEvalConfig>,
): EmotionalAxisEvalConfig {
  const prev = activeConfig;
  activeConfig = { ...activeConfig, ...config };
  return prev;
}

/**
 * Reset the config to defaults (full engine + full render).
 */
export function resetEmotionalAxisEvalConfig(): void {
  activeConfig = { ...defaultConfig };
}

/**
 * Apply a variant name to the eval config.
 * Convenience wrapper over setEmotionalAxisEvalConfig + resolveEmotionalAxisVariantConfig.
 */
export function applyEmotionalAxisVariant(variant: EmotionalAxisVariant): void {
  const { resolveEmotionalAxisVariantConfig } = require("./experimentVariants");
  setEmotionalAxisEvalConfig(resolveEmotionalAxisVariantConfig(variant));
}

/**
 * Scoped emotional-axis eval config helper (design D1).
 *
 * Applies a partial emotional-axis eval config for the duration of the
 * async callback, then restores the previous config in `finally`.
 *
 * This prevents config leakage across rows, scenarios, or test cases
 * without requiring callers to manually save/restore.
 */
export async function withEmotionalAxisEvalConfig<T>(
  config: Partial<EmotionalAxisEvalConfig>,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = setEmotionalAxisEvalConfig(config);
  try {
    return await fn();
  } finally {
    activeConfig = prev;
  }
}

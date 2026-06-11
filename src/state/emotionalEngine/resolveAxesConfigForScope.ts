// ---------------------------------------------------------------------------
// resolveAxesConfigForScope — Pure scope-aware axis-config resolver (D8)
//
// Returns a copy of `base` AxesConfig with each axis `baseline` overridden
// by `byScope[scope][axis]` when present. driftRate/min/max unchanged.
// Missing axis or scope ⇒ default baseline from `base`.
// ---------------------------------------------------------------------------

import type { AxesConfig, AxisName, CharacterStateAxes, ScopeBaselineOverrides } from './types';

const AXES: AxisName[] = ['connection', 'valence', 'arousal', 'restraint'];

/**
 * Resolve an AxesConfig for a given continuity scope.
 *
 * @param base    — Default emotional_axes config (structural defaults).
 * @param byScope — Optional per-scope baseline overrides (from YAML).
 * @param scope   — The session's continuityScope (e.g. "main_married").
 * @returns A new AxesConfig with scope-applied baselines.
 */
export function resolveAxesConfigForScope(
  base: AxesConfig,
  byScope: ScopeBaselineOverrides | undefined,
  scope: string,
): AxesConfig {
  const scopeOverrides = byScope?.[scope];
  if (!scopeOverrides) {
    // No overrides for this scope — return base unchanged
    return { ...base };
  }

  const result: AxesConfig = { ...base };
  for (const axis of AXES) {
    const override = scopeOverrides[axis as keyof CharacterStateAxes];
    if (override !== undefined) {
      result[axis] = { ...base[axis], baseline: override };
    }
  }
  return result;
}

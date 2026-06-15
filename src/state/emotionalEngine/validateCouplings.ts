// ---------------------------------------------------------------------------
// validateCouplings — Typed parser and warn-and-skip validator for the
// emotional_coupling YAML block. Runs at character-load time.
//
// Validation table (roadmap Rev 5):
//   - unknown source/target axis → skip+warn
//   - coefficient out of range → clamp+warn
//   - unknown derived_from → warn only (when valid sources known)
//   - unknown condition axis → treat unconditional+warn
//   - duplicate/missing id → auto-assign "<source>_<target>_<index>"+warn
//   - malformed → skip+error log
// ---------------------------------------------------------------------------

import type { EmotionalCoupling, EffectType, AxisName, CharacterStateAxes } from './types';
import { COEFFICIENT_RANGE_MIN, COEFFICIENT_RANGE_MAX, BASELINE_SHIFT_RANGE_MIN, BASELINE_SHIFT_RANGE_MAX } from './constants';

const VALID_AXES = new Set<AxisName>(['connection', 'valence', 'arousal', 'restraint']);
const VALID_EFFECT_TYPES = new Set<EffectType>(['direct_delta', 'drift_rate_scale', 'baseline_shift']);
const VALID_COMPARISONS = new Set<string>(['above', 'below']);

/** Counter used for auto-assigning ids on duplicate/missing. */
let _autoIdCounter = 0;
export function resetAutoIdCounter(): void { _autoIdCounter = 0; }

/**
 * Validate and normalise a raw coupling definition.
 *
 * @param raw   - The raw YAML-parsed coupling object.
 * @param index - Index in the coupling array (for log messages).
 * @param validDerivedFromSources - Optional set of valid internal_logic node names.
 *   When provided, unknown derived_from values emit a warning (but do not skip).
 * @returns A valid EmotionalCoupling or null (skip on hard errors).
 */
export function validateCoupling(
  raw: unknown,
  index: number,
  validDerivedFromSources?: Set<string>,
): EmotionalCoupling | null {
  if (typeof raw !== 'object' || raw === null) {
    console.error(`[validateCouplings] coupling[${index}] is not an object — skipping`);
    return null;
  }

  const c = raw as Record<string, unknown>;

  // ---- source validation ----
  const source = String(c.source ?? '');
  if (!VALID_AXES.has(source as AxisName)) {
    console.warn(`[validateCouplings] coupling[${index}]: unknown source "${source}" — skipping`);
    return null;
  }

  // ---- target validation ----
  const target = String(c.target ?? '');
  if (!VALID_AXES.has(target as AxisName)) {
    console.warn(`[validateCouplings] coupling[${index}]: unknown target "${target}" — skipping`);
    return null;
  }

  // ---- effect_type validation ----
  const effectType = String(c.effect_type ?? '');
  if (!VALID_EFFECT_TYPES.has(effectType as EffectType)) {
    console.error(`[validateCouplings] coupling[${index}]: invalid effect_type "${effectType}" — skipping`);
    return null;
  }

  // ---- coefficient validation (F20: non-finite → skip, finite out-of-range → clamp) ----
  const coefficientRaw = c.coefficient;
  if (coefficientRaw === undefined || coefficientRaw === null) {
    console.error(`[validateCouplings] coupling[${index}]: missing required coefficient — skipping`);
    return null;
  }
  const coefficientNum = Number(coefficientRaw);
  if (!Number.isFinite(coefficientNum)) {
    console.error(`[validateCouplings] coupling[${index}]: non-finite coefficient "${String(coefficientRaw)}" — skipping`);
    return null;
  }

  const rangeMin = effectType === 'baseline_shift' ? BASELINE_SHIFT_RANGE_MIN : COEFFICIENT_RANGE_MIN;
  const rangeMax = effectType === 'baseline_shift' ? BASELINE_SHIFT_RANGE_MAX : COEFFICIENT_RANGE_MAX;

  let coefficient = coefficientNum;
  if (coefficient < rangeMin || coefficient > rangeMax) {
    const clamped = Math.min(rangeMax, Math.max(rangeMin, coefficient));
    console.warn(
      `[validateCouplings] coupling[${index}]: coefficient ${coefficient} out of range [${rangeMin}, ${rangeMax}] — clamped to ${clamped}`,
    );
    coefficient = clamped;
  }

  // ---- id validation (auto-assign on duplicate/missing) ----
  let id = String(c.id ?? '').trim();
  if (!id) {
    id = `${source}_${target}_${_autoIdCounter++}`;
    console.warn(`[validateCouplings] coupling[${index}]: missing id — auto-assigned "${id}"`);
  }

  // ---- derived_from validation (F19: warn when unknown but known set provided) ----
  const derivedFrom = String(c.derived_from ?? '').trim();
  if (!derivedFrom) {
    console.warn(`[validateCouplings] coupling[${index}]: missing derived_from — warn only`);
  } else if (validDerivedFromSources && !validDerivedFromSources.has(derivedFrom)) {
    console.warn(
      `[validateCouplings] coupling[${index}]: unknown derived_from "${derivedFrom}" (not in internal_logic) — warn only`,
    );
  }

  // ---- condition validation ----
  let condition: EmotionalCoupling['condition'] = undefined;
  if (c.condition !== undefined && c.condition !== null) {
    if (typeof c.condition === 'object') {
      const cond = c.condition as Record<string, unknown>;
      const condAxis = String(cond.axis ?? '');
      const condThreshold = Number(cond.threshold);
      const condComparison = String(cond.comparison ?? '');

      if (!VALID_AXES.has(condAxis as AxisName)) {
        console.warn(
          `[validateCouplings] coupling[${index}]: unknown condition axis "${condAxis}" — treating as unconditional`,
        );
      } else if (!Number.isFinite(condThreshold)) {
        console.warn(
          `[validateCouplings] coupling[${index}]: invalid condition threshold — treating as unconditional`,
        );
      } else if (!VALID_COMPARISONS.has(condComparison)) {
        console.warn(
          `[validateCouplings] coupling[${index}]: invalid condition comparison "${condComparison}" — treating as unconditional`,
        );
      } else {
        condition = {
          axis: condAxis as keyof CharacterStateAxes,
          threshold: condThreshold,
          comparison: condComparison as 'above' | 'below',
        };
      }
    } else {
      console.warn(
        `[validateCouplings] coupling[${index}]: condition is not an object — treating as unconditional`,
      );
    }
  }

  // ---- build result (pass through label/description for tooltip support, design T2) ----
  const label = c.label !== undefined ? String(c.label) : undefined;
  const description = c.description !== undefined ? String(c.description) : undefined;

  return {
    id,
    source: source as keyof CharacterStateAxes,
    target: target as keyof CharacterStateAxes,
    effect_type: effectType as EffectType,
    coefficient,
    condition,
    derived_from: derivedFrom,
    label: label || undefined,
    description: description || undefined,
  };
}

/**
 * Validate an array of raw coupling definitions.
 *
 * @param raw   - The raw YAML-parsed coupling array.
 * @param validDerivedFromSources - Optional set of valid internal_logic node names
 *   for F19 unknown-derived_from warning.
 * @returns A clean array of valid EmotionalCoupling objects.
 */
export function validateCouplings(
  raw: unknown,
  validDerivedFromSources?: Set<string>,
): EmotionalCoupling[] {
  resetAutoIdCounter();

  if (!Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) {
      console.warn('[validateCouplings] emotional_coupling is not an array — ignoring');
    }
    return [];
  }

  const result: EmotionalCoupling[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const coupling = validateCoupling(raw[i], i, validDerivedFromSources);
    if (!coupling) continue;

    // Check for duplicate id after auto-assign
    if (seenIds.has(coupling.id)) {
      const newId = `${coupling.source}_${coupling.target}_${_autoIdCounter++}`;
      console.warn(`[validateCouplings] coupling[${i}]: duplicate id "${coupling.id}" — auto-assigned "${newId}"`);
      coupling.id = newId;
    }
    seenIds.add(coupling.id);
    result.push(coupling);
  }

  return result;
}

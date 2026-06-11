// ---------------------------------------------------------------------------
// bands.ts — Band computation with hysteresis (TG4 + D8 axis-aware)
//
// Axis-aware thresholds (design D8):
//   - Centered axes (connection, valence, arousal): high > +0.35, low < -0.35
//   - Restraint (bounded-style): high > 0.65, low < 0.35
// All axes use 0.1 hysteresis for enter/exit.
// ---------------------------------------------------------------------------

import {
  BAND_HIGH_THRESHOLD, BAND_LOW_THRESHOLD,
  CENTERED_HIGH_THRESHOLD, CENTERED_LOW_THRESHOLD,
  BAND_HYSTERESIS,
} from './constants';
import type { AxisName, Band } from './types';

/** All four axis keys. */
const AXES: AxisName[] = ['connection', 'valence', 'arousal', 'restraint'];

/** Centered axes use symmetric thresholds around 0. */
const CENTERED_AXES = new Set<AxisName>(['connection', 'valence', 'arousal']);

/**
 * Get band thresholds for a given axis.
 * Centered axes (connection, valence, arousal) use ±0.35.
 * Restraint uses the original 0.65/0.35 thresholds.
 */
function axisThresholds(axis: AxisName): { high: number; low: number } {
  if (CENTERED_AXES.has(axis)) {
    return { high: CENTERED_HIGH_THRESHOLD, low: CENTERED_LOW_THRESHOLD };
  }
  return { high: BAND_HIGH_THRESHOLD, low: BAND_LOW_THRESHOLD };
}

/**
 * Compute the new band for a single axis given its current value and previous band.
 */
export function computeBand(value: number, previousBand: Band, axis?: AxisName): Band {
  const t = axisThresholds(axis ?? 'restraint');

  if (previousBand === 'high') {
    // Stay high unless value drops below the exit threshold
    if (value < t.high - BAND_HYSTERESIS) return 'mid';
    return 'high';
  }
  if (previousBand === 'low') {
    // Stay low unless value rises above the exit threshold
    if (value > t.low + BAND_HYSTERESIS) return 'mid';
    return 'low';
  }
  // 'mid': determine which band to enter
  if (value > t.high) return 'high';
  if (value < t.low) return 'low';
  return 'mid';
}

/**
 * Compute bands for all four axes using axis-aware hysteresis,
 * seeded from previous bands.
 *
 * @param values  - Current axis values.
 * @param previous - Previous bands (from persisted state, or all 'mid' for first tick).
 * @returns New bands for all axes.
 */
export function computeBands(
  values: Record<AxisName, number>,
  previous: Record<AxisName, Band>,
): Record<AxisName, Band> {
  const result: Record<AxisName, Band> = { connection: 'mid', valence: 'mid', arousal: 'mid', restraint: 'mid' };
  for (const axis of AXES) {
    result[axis] = computeBand(values[axis], previous[axis], axis);
  }
  return result;
}

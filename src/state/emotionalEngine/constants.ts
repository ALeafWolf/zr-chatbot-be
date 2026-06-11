// ---------------------------------------------------------------------------
// Emotional Causal Model v1 — Engine invariants
// These are architecture-pinned constants, not per-character config.
// Tunable values (baselines, drift rates) live in each character's YAML.
// ---------------------------------------------------------------------------

/** Maximum single-axis change per update (architecture doc §11). */
export const MAX_AXIS_DELTA_PER_UPDATE = 0.1;

// ---------------------------------------------------------------------------
// Band thresholds (design D4 + D8 — axis-aware)
// ---------------------------------------------------------------------------

/** Restraint high threshold (bounded axis, baseline ~0.7). */
export const BAND_HIGH_THRESHOLD = 0.65;

/** Restraint low threshold (bounded axis, baseline ~0.7). */
export const BAND_LOW_THRESHOLD = 0.35;

/** Centered-axis high threshold (connection, valence, arousal, baseline ~0). */
export const CENTERED_HIGH_THRESHOLD = 0.35;

/** Centered-axis low threshold (connection, valence, arousal, baseline ~0). */
export const CENTERED_LOW_THRESHOLD = -0.35;

/** Hysteresis band width: prevents rapid toggling on boundary oscillation. */
export const BAND_HYSTERESIS = 0.1;

// ---------------------------------------------------------------------------
// Coefficient ranges (roadmap validation table)
// ---------------------------------------------------------------------------

/** Absolute max for `direct_delta` and `drift_rate_scale` coefficients. */
export const COEFFICIENT_RANGE_MIN = -5;
export const COEFFICIENT_RANGE_MAX = 5;

/** Tighter range for `baseline_shift` coefficients (shift is a resting-level offset). */
export const BASELINE_SHIFT_RANGE_MIN = -1;
export const BASELINE_SHIFT_RANGE_MAX = 1;

// ---------------------------------------------------------------------------
// History / render budget
// ---------------------------------------------------------------------------

/** Maximum number of tick snapshots kept in persisted axis state. */
export const HISTORY_CAP = 6;

/** Maximum number of render rules injected per turn. */
export const RENDER_BUDGET = 2;

// ---------------------------------------------------------------------------
// Event-to-delta mapping table (Step 3 — deterministic, zuo_ran-tuned first draft)
// Each event has base deltas per axis that get multiplied by intensity (0–1)
// before being clamped to ±MAX_AXIS_DELTA_PER_UPDATE.
// ---------------------------------------------------------------------------

import type { EventToDeltaMap } from './types';

/**
 * Base axis deltas per event type.
 * These are first-draft values — tunable against probe behavior.
 * Each entry is applied as `baseDelta[axis] * intensity` in Phase 1,
 * then clamped to ±MAX_AXIS_DELTA_PER_UPDATE.
 *
 * `routine_exchange` has all-zero deltas, resulting in a drift-only tick.
 */
export const EVENT_TO_DELTA_MAP: EventToDeltaMap = {
  routine_exchange: {},
  user_pursues_connection: { connection: 0.08, valence: 0.05 },
  user_withdraws: { connection: -0.08, valence: -0.05 },
  user_discloses_vulnerability: { connection: 0.06, valence: 0.03, arousal: -0.04 },
  user_shows_warmth: { valence: 0.06, connection: 0.04 },
  user_challenges: { arousal: 0.06, valence: -0.04 },
  tension_escalation: { arousal: 0.08, valence: -0.06, connection: -0.04 },
  intimate_moment: { connection: 0.10, valence: 0.08, arousal: 0.04 },
};

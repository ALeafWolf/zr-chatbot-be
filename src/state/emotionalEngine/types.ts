// ---------------------------------------------------------------------------
// Emotional Causal Model v1 — Core type schemas
// Matches roadmap Rev 5 verbatim.
// ---------------------------------------------------------------------------

/** The four session-local axes for v1. Immersion deferred to cross-session phase. */
export type AxisName = 'connection' | 'valence' | 'arousal' | 'restraint';

/** v1 axis vector — all four axes instantiated; immersion deferred. */
export interface CharacterStateAxes {
  connection: number;
  valence: number;
  arousal: number;
  restraint: number;
}

/** Per-axis configuration: resting baseline, drift speed, and range. */
export interface AxisConfig {
  baseline: number;
  driftRate: number;
  min: number;
  max: number;
}

/** Configuration block for all four axes. Absent ⇒ engine disabled for that character. */
export type AxesConfig = Record<AxisName, AxisConfig>;

// ---------------------------------------------------------------------------
// Coupling type system (roadmap Rev 5)
// ---------------------------------------------------------------------------

export type EffectType = 'direct_delta' | 'drift_rate_scale' | 'baseline_shift';

export interface CouplingCondition {
  axis: keyof CharacterStateAxes;
  threshold: number;
  comparison: 'above' | 'below';
}

/**
 * Stable-typed coupling definition.
 * `id` is required — render rules and traces reference couplings by id,
 * so renaming or reordering YAML cannot silently break the render layer.
 */
export interface EmotionalCoupling {
  id: string;
  source: keyof CharacterStateAxes;
  target: keyof CharacterStateAxes;
  effect_type: EffectType;
  coefficient: number;
  condition?: CouplingCondition;
  derived_from: string;
  /** Short Chinese name for tooltip display (design T2/T3). */
  label?: string;
  /** One-line Chinese explanation for tooltip display. */
  description?: string;
}

// ---------------------------------------------------------------------------
// State trace (Phase-4 contract — stable from day one)
// ---------------------------------------------------------------------------

/**
 * Per-turn state snapshot produced by Phase 4.
 * The render layer triggers off `couplingsFired` and `effectiveBaselines`,
 * NEVER off raw value diffs it re-derives itself.
 */
export interface ConditionTransition {
  id: string;
  from: boolean;
  to: boolean;
}

// ---------------------------------------------------------------------------
// TurnEvent classifier output model (Step 3 — replaces interim flat-delta path)
// ---------------------------------------------------------------------------

/**
 * The 8 event types for the two-stage extraction.
 * Each represents a user-initiated interaction pattern that drives axis deltas
 * deterministically via the event-to-delta mapping table.
 */
export type TurnEventType =
  | 'routine_exchange'
  | 'user_pursues_connection'
  | 'user_withdraws'
  | 'user_discloses_vulnerability'
  | 'user_shows_warmth'
  | 'user_challenges'
  | 'tension_escalation'
  | 'intimate_moment';

/**
 * Classified turn event — the sole output of the extractor's event-classifier
 * path. No `confidence` field (excluded per v1 scope decision).
 */
export interface TurnEvent {
  type: TurnEventType;
  /** Intensity 0–1, scales the base deltas in the mapping table. */
  intensity: number;
  /** Natural-language rationale for the classification. */
  reason: string;
}

export interface StateTrace {
  tick: number;
  /** Classified TurnEvent from the two-stage extractor (Step 3). */
  event?: TurnEvent;
  axesBefore: CharacterStateAxes;
  axesAfter: CharacterStateAxes;
  /** Coupling ids whose effect was non-zero this tick. */
  couplingsFired: string[];
  /** Where each shifted axis is currently headed. */
  effectiveBaselines: Partial<CharacterStateAxes>;
  /** Condition transitions this tick (F25 — used by R2 snap-back detection). */
  conditionTransitions?: ConditionTransition[];
}

// ---------------------------------------------------------------------------
// Event deltas (interim flat-delta path for Step 1)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Event-to-delta mapping (Step 3 — deterministic, in engine config)
// ---------------------------------------------------------------------------

/**
 * Per-event-type base axis deltas. Each tuple is `{ connection?, valence?, arousal?, restraint? }`
 * — all optional. The caller multiplies each base delta by the event's intensity (0–1)
 * and clamps to ±MAX_AXIS_DELTA_PER_UPDATE before passing into Phase 1.
 */
export type EventToDeltaMap = Record<TurnEventType, Partial<CharacterStateAxes>>;

/** Flat axis deltas emitted by the interim extractor (pre-Step-3 path). Kept for backward compat in tests. */
export type EventDeltas = Partial<CharacterStateAxes>;

// ---------------------------------------------------------------------------
// advanceCharacterState return
// ---------------------------------------------------------------------------

export interface AdvanceResult {
  next: CharacterStateAxes;
  trace: StateTrace;
}

// ---------------------------------------------------------------------------
// TG2: Eval-only phase emission types
// ---------------------------------------------------------------------------

/**
 * The four intermediate phase states produced by the engine step.
 * Emitted only when `emitPhases: true` is passed to `advanceCharacterState`.
 */
export interface PhasesData {
  afterEventDelta: CharacterStateAxes;
  afterCoupling: CharacterStateAxes;
  afterDrift: CharacterStateAxes;
  afterClamp: CharacterStateAxes; // equals axesAfter
}

/**
 * Eval-only trace extension returned when `emitPhases` is enabled.
 * Keeps the production `StateTrace` contract clean — `phases` is absent
 * in normal operation.
 */
export interface ExtendedStateTrace extends StateTrace {
  phases?: PhasesData;
}

// ---------------------------------------------------------------------------
// Persisted axis state (design D2 — versioned sub-object in local_relationship_delta)
// ---------------------------------------------------------------------------

/** Band label per axis after hysteresis. */
export type Band = 'high' | 'mid' | 'low';

/** Snapshot entry in the bounded history array. */
export interface HistoryEntry {
  tick: number;
  axes: CharacterStateAxes;
}

/**
 * Shape of the `axis_state` sub-object stored inside
 * `session_state.local_relationship_delta` JSONB.
 * Versioned so shape changes are detectable.
 */
export interface PersistedAxisState {
  version: 1;
  tick: number;
  axes: CharacterStateAxes;
  lastTrace: StateTrace;
  bands: Record<AxisName, Band>;
  /** Bounded, newest-last, cap HISTORY_CAP. */
  history: HistoryEntry[];
}

// ---------------------------------------------------------------------------
// Scope-varying baseline overrides (design D8)
// ---------------------------------------------------------------------------

/**
 * Per-scope baseline overrides for each axis.
 * Keyed by `continuityScope` value (e.g. "main_relationship", "main_married").
 * Missing axes fall back to the default `emotional_axes` baseline.
 */
export type ScopeBaselineOverrides = Record<string, Partial<CharacterStateAxes>>;

// ---------------------------------------------------------------------------
// TG1: Per-turn export snapshot (stored in chat_messages.emotional_axis JSONB)
// ---------------------------------------------------------------------------

/**
 * Versioned per-turn emotional-axis snapshot stored on the assistant message.
 * Built during the post-turn engine step and consumed by export formatters.
 */
export interface EmotionalAxisTurnExportSnapshot {
  version: 1;
  source: "post_turn_engine";
  tick: number;
  scope: string;
  axes: CharacterStateAxes;
  bands: Record<AxisName, Band>;
  axes_before?: CharacterStateAxes;
  event_type?: TurnEventType;
  event_intensity?: number;
  event_deltas?: Partial<CharacterStateAxes>;
  couplings_fired?: string[];
  effective_baselines?: Partial<CharacterStateAxes>;
  condition_transitions?: ConditionTransition[];
  resolved_baselines?: CharacterStateAxes;
}

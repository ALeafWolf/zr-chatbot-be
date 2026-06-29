// ---------------------------------------------------------------------------
// advanceCharacterState — Pure state engine core (TG6: full four-phase model)
//
// Phase 1: Apply event deltas (clamped to ±MAX_AXIS_DELTA_PER_UPDATE)
// Phase 2: Direct coupling deltas (direct_delta, simultaneous batch)
// Phase 3: baseline_shift → effective baselines; drift_rate_scale → effective
//          rates; then drift toward effective baseline at effective rate
// Phase 4: Clamp + build trace with real couplingsFired / effectiveBaselines
// ---------------------------------------------------------------------------

import { MAX_AXIS_DELTA_PER_UPDATE } from './constants';
import type {
  CharacterStateAxes,
  AxesConfig,
  EmotionalCoupling,
  EventDeltas,
  TurnEvent,
  AdvanceResult,
  AxisName,
  ExtendedStateTrace,
  PhasesData,
} from './types';

// All four axis keys as a const array for iteration.
const AXES: AxisName[] = ['connection', 'valence', 'arousal', 'restraint'];

// ---------------------------------------------------------------------------
// Clamp helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function clampDelta(delta: number): number {
  return clamp(delta, -MAX_AXIS_DELTA_PER_UPDATE, MAX_AXIS_DELTA_PER_UPDATE);
}

// ---------------------------------------------------------------------------
// Condition checker
// ---------------------------------------------------------------------------

function checkCondition(
  coupling: EmotionalCoupling,
  state: CharacterStateAxes,
): boolean {
  if (!coupling.condition) return true;
  const value = state[coupling.condition.axis];
  if (coupling.condition.comparison === 'above') return value > coupling.condition.threshold;
  return value < coupling.condition.threshold;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Advance character state by one tick with full coupling execution (TG6).
 *
 * @param state      - Current axis values.
 * @param axesConfig - Per-axis baseline, driftRate, min, max.
 * @param couplings  - Coupling definitions.
 * @param eventDeltas - Incoming flat axis deltas from the event-to-delta mapping.
 * @param tick       - Monotonic tick number.
 * @param event      - Classified TurnEvent for this tick (Step 3). Recorded in trace; undefined when extraction fails.
 * @param emitPhases - TG2: When true, capture intermediate phase states and return them in an
 *                     `ExtendedStateTrace`. The production `StateTrace` is clean — `phases` is
 *                     absent unless explicitly requested.
 * @returns `{ next, trace }` with the new state and a Phase-4 trace.
 */
export function advanceCharacterState(
  state: CharacterStateAxes,
  axesConfig: AxesConfig,
  couplings: EmotionalCoupling[],
  eventDeltas: EventDeltas,
  tick: number,
  event?: TurnEvent,
  emitPhases?: boolean,
): AdvanceResult {
  // Snapshot axes before any mutation.
  const axesBefore: CharacterStateAxes = { ...state };

  // TG2: Caputure intermediate phase states when emitPhases is enabled.
  let phases: PhasesData | undefined;

  // ---------------------------------------------------------------
  // Phase 1 — Apply event deltas (clamped)
  // ---------------------------------------------------------------
  const afterPhase1: CharacterStateAxes = { ...state };

  for (const axis of AXES) {
    const rawDelta = eventDeltas[axis];
    if (rawDelta === undefined) continue;
    afterPhase1[axis] += clampDelta(rawDelta);
  }

  // Compute Phase-1 deltas for coupling reactions.
  const phase1Delta: CharacterStateAxes = { connection: 0, valence: 0, arousal: 0, restraint: 0 };
  for (const axis of AXES) {
    phase1Delta[axis] = afterPhase1[axis] - state[axis];
  }

  // TG2: Record phase after event deltas applied.
  if (emitPhases) {
    phases = { afterEventDelta: { ...afterPhase1 }, afterCoupling: { ...afterPhase1 }, afterDrift: { ...afterPhase1 }, afterClamp: { ...afterPhase1 } };
  }

  // ---------------------------------------------------------------
  // Phase 2 — Direct coupling deltas (simultaneous batch)
  // ---------------------------------------------------------------
  const afterPhase2: CharacterStateAxes = { ...afterPhase1 };
  const couplingsFired: string[] = [];

  // Accumulate direct_delta contributions per target axis.
  const directDeltas: Partial<CharacterStateAxes> = {};

  for (const coupling of couplings) {
    if (coupling.effect_type !== 'direct_delta') continue;
    if (!checkCondition(coupling, afterPhase1)) continue;

    const sourceDelta = phase1Delta[coupling.source];
    if (sourceDelta === 0) continue;

    const targetDelta = sourceDelta * coupling.coefficient;
    directDeltas[coupling.target] = (directDeltas[coupling.target] ?? 0) + targetDelta;
    couplingsFired.push(coupling.id);
  }

  // Apply batch of direct deltas.
  for (const axis of AXES) {
    const d = directDeltas[axis];
    if (d !== undefined) afterPhase2[axis] += d;
  }

  // TG2: Record phase after coupling deltas applied.
  if (emitPhases && phases) {
    phases.afterCoupling = { ...afterPhase2 };
  }

  // ---------------------------------------------------------------
  // Phase 3 — Resolve effective baselines + drift
  // ---------------------------------------------------------------
  const effectiveBaselines: Partial<CharacterStateAxes> = {};
  const effectiveRates: Partial<CharacterStateAxes> = {};

  // Start from base config.
  for (const axis of AXES) {
    effectiveBaselines[axis] = axesConfig[axis].baseline;
    effectiveRates[axis] = axesConfig[axis].driftRate;
  }

  // baseline_shift: accumulate raw offsets per target, then add and clamp once
  // (F22: sum-then-clamp guarantees order independence).
  const baselineOffsets: Partial<CharacterStateAxes> = {};
  for (const coupling of couplings) {
    if (coupling.effect_type !== 'baseline_shift') continue;
    if (!checkCondition(coupling, afterPhase2)) continue;

    const offset = coupling.coefficient * afterPhase2[coupling.source];
    baselineOffsets[coupling.target] = (baselineOffsets[coupling.target] ?? 0) + offset;

    if (!couplingsFired.includes(coupling.id)) {
      couplingsFired.push(coupling.id);
    }
  }
  for (const axis of AXES) {
    const offset = baselineOffsets[axis];
    if (offset !== undefined) {
      effectiveBaselines[axis] = clamp(
        axesConfig[axis].baseline + offset,
        axesConfig[axis].min,
        axesConfig[axis].max,
      );
    }
  }

  // drift_rate_scale: modify drift rates.
  for (const coupling of couplings) {
    if (coupling.effect_type !== 'drift_rate_scale') continue;
    if (!checkCondition(coupling, afterPhase2)) continue;

    const sourceValue = afterPhase2[coupling.source];
    const baseRate = axesConfig[coupling.target].driftRate;
    const effectiveRate = baseRate * (1 + (coupling.coefficient - 1) * sourceValue);
    effectiveRates[coupling.target] = Math.max(0, effectiveRate); // non-negative

    if (!couplingsFired.includes(coupling.id)) {
      couplingsFired.push(coupling.id);
    }
  }

  // Drift once per axis toward effective baseline at effective rate.
  const afterDrift: CharacterStateAxes = { ...afterPhase2 };

  for (const axis of AXES) {
    const current = afterPhase2[axis];
    const targetBaseline = effectiveBaselines[axis]!;
    const rate = effectiveRates[axis]!;

    if (current < targetBaseline) {
      const step = Math.min(rate, targetBaseline - current);
      afterDrift[axis] = current + step;
    } else if (current > targetBaseline) {
      const step = Math.min(rate, current - targetBaseline);
      afterDrift[axis] = current - step;
    }
  }

  // TG2: Record phase after drift toward effective baseline.
  if (emitPhases && phases) {
    phases.afterDrift = { ...afterDrift };
  }

  // ---------------------------------------------------------------
  // Phase 4 — Clamp each axis + build trace
  // ---------------------------------------------------------------
  const next: CharacterStateAxes = { ...afterDrift };

  for (const axis of AXES) {
    const config = axesConfig[axis];
    next[axis] = clamp(next[axis], config.min, config.max);
  }

  // TG2: Record phase after clamp — afterClamp MUST equal axesAfter.
  if (emitPhases && phases) {
    phases.afterClamp = { ...next };
  }

  // Compute condition transitions (F25): detect couplings whose condition flipped
  // from satisfied to unsatisfied (or vice versa) this tick.
  const conditionTransitions: Array<{ id: string; from: boolean; to: boolean }> = [];
  for (const coupling of couplings) {
    if (!coupling.condition) continue;
    const before = checkCondition(coupling, state);
    const after = checkCondition(coupling, afterPhase2);
    if (before !== after) {
      conditionTransitions.push({ id: coupling.id, from: before, to: after });
    }
  }

  // Only include shifted baselines in the trace.
  const traceEffectiveBaselines: Partial<CharacterStateAxes> = {};
  for (const axis of AXES) {
    const base = axesConfig[axis].baseline;
    const eff = effectiveBaselines[axis]!;
    if (Math.abs(eff - base) > 1e-12) {
      traceEffectiveBaselines[axis] = eff;
    }
  }

  const baseTrace = {
    tick,
    event,
    axesBefore,
    axesAfter: { ...next },
    couplingsFired,
    effectiveBaselines: traceEffectiveBaselines,
    conditionTransitions: conditionTransitions.length > 0 ? conditionTransitions : undefined,
  };

  if (emitPhases) {
    const extended: ExtendedStateTrace = { ...baseTrace, phases };
    return { next, trace: extended };
  }

  return { next, trace: baseTrace };
}

// ---------------------------------------------------------------------------
// resolveEmotionalRenderInputs — Pure helper for read-side render wiring (D8)
//
// Returns persisted bands/trace/history when axis_state exists, else
// synthesises render-from-baselines from the scope-resolved config.
// Returns null only when genuinely unrenderable (no emotional_axes config).
// ---------------------------------------------------------------------------

import type { AxesConfig, ScopeBaselineOverrides, Band, StateTrace, HistoryEntry, AxisName, CharacterStateAxes } from './types';
import { readAxisState } from './axisStatePersistence';
import { resolveAxesConfigForScope } from './resolveAxesConfigForScope';
import { computeBands } from './bands';

export interface EmotionalRenderInputs {
  emotionalAxisBands: Record<AxisName, Band>;
  emotionalAxisLastTrace: StateTrace;
  emotionalAxisHistory: HistoryEntry[];
  /** TG1: Source of the render input data — persisted axis state or synthetic from scope baselines. */
  source: "persisted_axis_state" | "scope_baseline_synthetic";
  /** TG1: Tick number from the source trace (0 for synthetic fallback). */
  sourceTick: number;
  /** TG1: Continuity scope used when resolving baselines. */
  scope: string;
  /** TG1: Scope-resolved baselines (NOT the raw YAML base). */
  resolvedBaselines: CharacterStateAxes;
}

/**
 * Resolve emotional render inputs from session state and character config.
 *
 * @param sessionStateRow — Raw session_state row (from resolveContext, may be null).
 * @param axesConfig      — Default emotional_axes config from character.
 * @param byScope          — Optional per-scope baseline overrides.
 * @param scope            — Current continuityScope.
 * @returns Render inputs, or null when render is genuinely impossible (no axesConfig).
 */
export function resolveEmotionalRenderInputs(
  sessionStateRow: Record<string, unknown> | null,
  axesConfig: AxesConfig | undefined,
  byScope: ScopeBaselineOverrides | undefined,
  scope: string,
): EmotionalRenderInputs | null {
  if (!axesConfig) return null;

  // Check if persisted axis_state key exists but is corrupt (F14).
  // If the row has an `axis_state` key in `localRelationshipDelta` but
  // `readAxisState` returns null, the state is corrupt — skip render.
  const hasAxisStateKey = Boolean(
    sessionStateRow?.localRelationshipDelta &&
    typeof sessionStateRow.localRelationshipDelta === 'object' &&
    'axis_state' in (sessionStateRow.localRelationshipDelta as Record<string, unknown>),
  );

  // Try persisted axis state
  const persisted = readAxisState(sessionStateRow as any);
  if (persisted) {
    const resolvedBaselines = resolveAxesConfigForScope(axesConfig, byScope, scope);
    return {
      emotionalAxisBands: persisted.bands,
      emotionalAxisLastTrace: persisted.lastTrace,
      emotionalAxisHistory: persisted.history,
      source: "persisted_axis_state",
      sourceTick: persisted.lastTrace.tick,
      scope,
      resolvedBaselines: {
        connection: resolvedBaselines.connection.baseline,
        valence: resolvedBaselines.valence.baseline,
        arousal: resolvedBaselines.arousal.baseline,
        restraint: resolvedBaselines.restraint.baseline,
      } as CharacterStateAxes,
    };
  }

  // If axis_state key existed but readAxisState returned null → corrupt → skip
  if (hasAxisStateKey) return null;

  // Render-from-baselines: resolve scope config, compute bands from baselines
  const scopeConfig = resolveAxesConfigForScope(axesConfig, byScope, scope);
  const resolvedBaselines = {
    connection: scopeConfig.connection.baseline,
    valence: scopeConfig.valence.baseline,
    arousal: scopeConfig.arousal.baseline,
    restraint: scopeConfig.restraint.baseline,
  } as CharacterStateAxes;

  const allMid: Record<AxisName, Band> = { connection: 'mid', valence: 'mid', arousal: 'mid', restraint: 'mid' };
  const bands = computeBands(resolvedBaselines, allMid);

  const syntheticTrace: StateTrace = {
    tick: 0,
    axesBefore: { ...resolvedBaselines },
    axesAfter: { ...resolvedBaselines },
    couplingsFired: [],
    effectiveBaselines: {},
    conditionTransitions: undefined,
  };

  return {
    emotionalAxisBands: bands,
    emotionalAxisLastTrace: syntheticTrace,
    emotionalAxisHistory: [],
    source: "scope_baseline_synthetic",
    sourceTick: 0,
    scope,
    resolvedBaselines,
  };
}

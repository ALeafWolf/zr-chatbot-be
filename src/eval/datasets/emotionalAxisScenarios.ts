// ---------------------------------------------------------------------------
// emotionalAxisScenarios.ts — Emotional-axis eval scenarios (TG3 stub)
//
// Full dataset to be populated in TG4 with 12 axis-movement probes,
// coupling probes, and render-rule probes.
// ---------------------------------------------------------------------------

import type { Scenario } from "../evalTypes";

/**
 * Emotional-axis scenarios for the dedicated `emotional_axis` scenario set.
 *
 * Each scenario can carry:
 * - `seedAxisState` for deterministic axis state seeding
 * - `expectedResolvedBaselines` for scope-resolved baseline assertions
 * - `noScopeOverride` for structural-base (YAML raw) baseline tests
 * - Emotional-axis assertion types (turn_event_type, axis_delta_sign, etc.)
 */
export const EMOTIONAL_AXIS_SCENARIOS: Scenario[] = [];

// ---------------------------------------------------------------------------
// emotionalAxisScenarios.ts — Emotional-axis eval scenarios (TG4)
//
// 12 axis-movement probes (AX01–AX12), 6 coupling probes (CP-*),
// and render-rule probes matching all 9 rule IDs.
//
// All scenarios use eval_mode="agent_turn" and rely on the emotional-axis
// eval snapshot for assertion evaluation.
//
// Seeds and expectations follow the corrected probe matrix (roadmap §4).
// ---------------------------------------------------------------------------

import type { Scenario } from "../evalTypes";

const BASE_SESSION = {
  mode: "canonical_live",
  continuity_scope: "main_relationship",
  continuity_family: "main_world",
} as const;

// ---------------------------------------------------------------------------
// Prior state seeds (roadmap §4.1 — corrected to real baselines/bands)
// ---------------------------------------------------------------------------

const NEUTRAL_SEED = {
  version: 1 as const,
  tick: 1,
  axes: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 },
  lastTrace: {
    tick: 1,
    axesBefore: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 },
    axesAfter: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 },
    couplingsFired: [],
    effectiveBaselines: {},
  },
  bands: { connection: "mid", valence: "mid", arousal: "mid", restraint: "high" },
  history: [],
};

const SAFE_CLOSENESS_SEED = {
  version: 1 as const,
  tick: 1,
  axes: { connection: 0.55, valence: 0.45, arousal: -0.05, restraint: 0.45 },
  lastTrace: {
    tick: 1,
    axesBefore: { connection: 0.55, valence: 0.45, arousal: -0.05, restraint: 0.45 },
    axesAfter: { connection: 0.55, valence: 0.45, arousal: -0.05, restraint: 0.45 },
    couplingsFired: [],
    effectiveBaselines: {},
  },
  bands: { connection: "high", valence: "high", arousal: "mid", restraint: "mid" },
  history: [],
};

const LOW_VALENCE_FALLING_CONN_SEED = {
  version: 1 as const,
  tick: 1,
  axes: { connection: -0.35, valence: -0.5, arousal: 0.35, restraint: 0.85 },
  lastTrace: {
    tick: 1,
    axesBefore: { connection: -0.35, valence: -0.5, arousal: 0.35, restraint: 0.85 },
    axesAfter: { connection: -0.35, valence: -0.5, arousal: 0.35, restraint: 0.85 },
    couplingsFired: [],
    effectiveBaselines: {},
  },
  bands: { connection: "low", valence: "low", arousal: "mid", restraint: "high" },
  history: [],
};

const DEFENSIVE_DISTANCE_SEED = {
  version: 1 as const,
  tick: 1,
  axes: { connection: -0.25, valence: -0.2, arousal: 0.25, restraint: 0.8 },
  lastTrace: {
    tick: 1,
    axesBefore: { connection: -0.25, valence: -0.2, arousal: 0.25, restraint: 0.8 },
    axesAfter: { connection: -0.25, valence: -0.2, arousal: 0.25, restraint: 0.8 },
    couplingsFired: [],
    effectiveBaselines: {},
  },
  bands: { connection: "mid", valence: "mid", arousal: "mid", restraint: "high" },
  history: [],
};

const HIGH_AROUSAL_HIGH_RESTRAINT_SEED = {
  version: 1 as const,
  tick: 1,
  axes: { connection: 0.2, valence: -0.1, arousal: 0.65, restraint: 0.85 },
  lastTrace: {
    tick: 1,
    axesBefore: { connection: 0.2, valence: -0.1, arousal: 0.65, restraint: 0.85 },
    axesAfter: { connection: 0.2, valence: -0.1, arousal: 0.65, restraint: 0.85 },
    couplingsFired: [],
    effectiveBaselines: {},
  },
  bands: { connection: "mid", valence: "mid", arousal: "high", restraint: "high" },
  history: [],
};

const LOW_RESTRAINT_SAFE_BOND_SEED = {
  version: 1 as const,
  tick: 1,
  axes: { connection: 0.7, valence: 0.55, arousal: -0.4, restraint: 0.25 },
  lastTrace: {
    tick: 1,
    axesBefore: { connection: 0.7, valence: 0.55, arousal: -0.4, restraint: 0.25 },
    axesAfter: { connection: 0.7, valence: 0.55, arousal: -0.4, restraint: 0.25 },
    couplingsFired: [],
    effectiveBaselines: {},
  },
  bands: { connection: "high", valence: "high", arousal: "low", restraint: "low" },
  history: [],
};

// ---------------------------------------------------------------------------
// 12 axis-movement probes (roadmap §4.2) — assert delta sign / band
// ---------------------------------------------------------------------------

const AXIS_MOVEMENT_PROBES: Scenario[] = [
  {
    id: "AX01",
    description: "user_pursues_connection → connection +, valence +",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: NEUTRAL_SEED,
    messages: [{ role: "user", content: "我最近常想起我们之前聊的那些事。" }],
    assertions: [
      { type: "turn_event_type", value: "user_pursues_connection", description: "Event is user_pursues_connection" },
      { type: "axis_delta_sign", field: "connection", value: "+", description: "Connection delta positive" },
      { type: "axis_delta_sign", field: "valence", value: "+", description: "Valence delta positive" },
    ],
  },
  {
    id: "AX02",
    description: "user_withdraws → connection -, valence -",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: NEUTRAL_SEED,
    messages: [{ role: "user", content: "算了，不说了。" }],
    assertions: [
      { type: "turn_event_type", value: "user_withdraws", description: "Event is user_withdraws" },
      { type: "axis_delta_sign", field: "connection", value: "-", description: "Connection delta negative" },
      { type: "axis_delta_sign", field: "valence", value: "-", description: "Valence delta negative" },
    ],
  },
  {
    id: "AX03",
    description: "user_discloses_vulnerability → connection +, valence +, arousal -",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: NEUTRAL_SEED,
    messages: [{ role: "user", content: "其实我最近压力很大，觉得挺累的。" }],
    assertions: [
      { type: "turn_event_type", value: "user_discloses_vulnerability", description: "Event is user_discloses_vulnerability" },
      { type: "axis_delta_sign", field: "connection", value: "+", description: "Connection delta positive" },
      { type: "axis_delta_sign", field: "valence", value: "+", description: "Valence delta positive" },
      { type: "axis_delta_sign", field: "arousal", value: "-", description: "Arousal delta negative" },
    ],
  },
  {
    id: "AX04",
    description: "user_shows_warmth → valence +, connection +",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: NEUTRAL_SEED,
    messages: [{ role: "user", content: "你对我来说真的很重要。" }],
    assertions: [
      { type: "turn_event_type", value: "user_shows_warmth", description: "Event is user_shows_warmth" },
      { type: "axis_delta_sign", field: "valence", value: "+", description: "Valence delta positive" },
      { type: "axis_delta_sign", field: "connection", value: "+", description: "Connection delta positive" },
    ],
  },
  {
    id: "AX05",
    description: "user_challenges → arousal +, valence -",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: NEUTRAL_SEED,
    messages: [{ role: "user", content: "你上次说的我不同意。" }],
    assertions: [
      { type: "turn_event_type", value: "user_challenges", description: "Event is user_challenges" },
      { type: "axis_delta_sign", field: "arousal", value: "+", description: "Arousal delta positive" },
      { type: "axis_delta_sign", field: "valence", value: "-", description: "Valence delta negative" },
    ],
  },
  {
    id: "AX06",
    description: "tension_escalation → arousal +, valence -, connection -",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: NEUTRAL_SEED,
    messages: [{ role: "user", content: "你根本不理解我。每次都这样。" }],
    assertions: [
      { type: "turn_event_type", value: "tension_escalation", description: "Event is tension_escalation" },
      { type: "axis_delta_sign", field: "arousal", value: "+", description: "Arousal delta positive" },
      { type: "axis_delta_sign", field: "valence", value: "-", description: "Valence delta negative" },
      { type: "axis_delta_sign", field: "connection", value: "-", description: "Connection delta negative" },
    ],
  },
  {
    id: "AX07",
    description: "intimate_moment → connection +, valence +, arousal +",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: NEUTRAL_SEED,
    messages: [{ role: "user", content: "我喜欢你。从第一次见面就喜欢。" }],
    assertions: [
      { type: "turn_event_type", value: "intimate_moment", description: "Event is intimate_moment" },
      { type: "axis_delta_sign", field: "connection", value: "+", description: "Connection delta positive" },
      { type: "axis_delta_sign", field: "valence", value: "+", description: "Valence delta positive" },
      { type: "axis_delta_sign", field: "arousal", value: "+", description: "Arousal delta positive" },
    ],
  },
  {
    id: "AX08",
    description: "routine_exchange → drift-only, all deltas 0/stable",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: NEUTRAL_SEED,
    messages: [{ role: "user", content: "今天天气不错。" }],
    assertions: [
      { type: "turn_event_type", value: "routine_exchange", description: "Event is routine_exchange" },
      { type: "axis_delta_sign", field: "connection", value: "0", description: "Connection drift-only (0)" },
      { type: "axis_delta_sign", field: "valence", value: "0", description: "Valence drift-only (0)" },
    ],
  },
  {
    id: "AX09",
    description: "safe closeness → connection high, restraint mid baseline",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: SAFE_CLOSENESS_SEED,
    messages: [{ role: "user", content: "今天天气不错。" }],
    assertions: [
      { type: "axis_band_equals", field: "connection", value: "high", description: "Connection stays high in safe closeness" },
      { type: "axis_band_equals", field: "restraint", value: "mid", description: "Restraint stays mid" },
    ],
  },
  {
    id: "AX10",
    description: "defensive distance → arousal mid, restraint high",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: DEFENSIVE_DISTANCE_SEED,
    messages: [{ role: "user", content: "今天天气不错。" }],
    assertions: [
      { type: "axis_band_equals", field: "restraint", value: "high", description: "Restraint stays high" },
    ],
  },
  {
    id: "AX11",
    description: "high arousal high restraint → arousal high, restraint high",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: HIGH_AROUSAL_HIGH_RESTRAINT_SEED,
    messages: [{ role: "user", content: "今天天气不错。" }],
    assertions: [
      { type: "axis_band_equals", field: "arousal", value: "high", description: "Arousal stays high" },
      { type: "axis_band_equals", field: "restraint", value: "high", description: "Restraint stays high" },
    ],
  },
  {
    id: "AX12",
    description: "low restraint safe bond → connection high, restraint low, arousal low",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: LOW_RESTRAINT_SAFE_BOND_SEED,
    messages: [{ role: "user", content: "今天天气不错。" }],
    assertions: [
      { type: "axis_band_equals", field: "connection", value: "high", description: "Connection stays high" },
      { type: "axis_band_equals", field: "restraint", value: "low", description: "Restraint stays low" },
      { type: "axis_band_equals", field: "arousal", value: "low", description: "Arousal stays low" },
    ],
  },
];

// ---------------------------------------------------------------------------
// 6 coupling probes (roadmap §4.3)
// ---------------------------------------------------------------------------

const COUPLING_PROBES: Scenario[] = [
  {
    id: "CP-zr_c1",
    description: "user_challenges → arousal+ → zr_c1 fires, restraint rises",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: NEUTRAL_SEED,
    messages: [{ role: "user", content: "你上次说的我不同意。" }],
    assertions: [
      { type: "couplings_fired_contains", values: ["zr_c1"], description: "zr_c1 fired via arousal+" },
      { type: "axis_delta_sign", field: "restraint", value: "+", description: "Restraint rises from zr_c1" },
    ],
  },
  {
    id: "CP-zr_c1-down",
    description: "user_discloses_vulnerability → arousal- → zr_c1 fires, restraint slight -",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: SAFE_CLOSENESS_SEED,
    messages: [{ role: "user", content: "其实我最近压力很大，觉得挺累的。" }],
    assertions: [
      { type: "couplings_fired_contains", values: ["zr_c1"], description: "zr_c1 fired via arousal-" },
      { type: "axis_delta_sign", field: "restraint", value: "-", description: "Restraint slight negative" },
    ],
  },
  {
    id: "CP-zr_c2",
    description: "positive turn with valence>0 → zr_c2 baseline_shift → restraint baseline drops",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: SAFE_CLOSENESS_SEED,
    messages: [{ role: "user", content: "你今天看起来心情不错。" }],
    assertions: [
      { type: "effective_baseline_shifted", field: "restraint", value: "-", description: "zr_c2 shifts restraint baseline down" },
    ],
  },
  {
    id: "CP-zr_c2-gate",
    description: "low valence+falling conn → valence<0 → zr_c2 NOT fired",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: LOW_VALENCE_FALLING_CONN_SEED,
    messages: [{ role: "user", content: "你上次说的我不同意。" }],
    assertions: [
      { type: "couplings_fired_not_contains", values: ["zr_c2"], description: "zr_c2 NOT fired (valence<0)" },
    ],
  },
  {
    id: "CP-zr_c3",
    description: "low valence+falling conn + negative event → zr_c3 fires, restraint rises",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: LOW_VALENCE_FALLING_CONN_SEED,
    messages: [{ role: "user", content: "你根本不理解我。" }],
    assertions: [
      { type: "couplings_fired_contains", values: ["zr_c3"], description: "zr_c3 fired (valence< -0.2 + negative delta)" },
      { type: "axis_delta_sign", field: "restraint", value: "+", description: "Restraint rises from zr_c3" },
    ],
  },
  {
    id: "CP-zr_c3-gate",
    description: "neutral valence, mild negative → zr_c3 NOT fired",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: NEUTRAL_SEED,
    messages: [{ role: "user", content: "嗯，也许你说得对。" }],
    assertions: [
      { type: "couplings_fired_not_contains", values: ["zr_c3"], description: "zr_c3 NOT fired (valence not < -0.2)" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Render-rule probe seeds — the render snapshot is captured pre-generation,
// reading the seeded lastTrace/history, NOT the current turn's event.
// Each seed below carries the trigger data that the render layer reads.
// ---------------------------------------------------------------------------

/** R4: C high, V high, A low → pure-state rule check. */
const R4_SEED = {
  version: 1 as const,
  tick: 2,
  axes: { connection: 0.5, valence: 0.5, arousal: -0.4, restraint: 0.6 },
  lastTrace: {
    tick: 2,
    axesBefore: { connection: 0.5, valence: 0.5, arousal: -0.4, restraint: 0.6 },
    axesAfter: { connection: 0.5, valence: 0.5, arousal: -0.4, restraint: 0.6 },
    couplingsFired: [],
    effectiveBaselines: {},
  },
  bands: { connection: "high", valence: "high", arousal: "low", restraint: "mid" },
  history: [],
};

/** R5_state: history shows connection falling over 2 ticks. */
const R5_STATE_SEED = {
  version: 1 as const,
  tick: 3,
  axes: { connection: -0.1, valence: 0, arousal: 0, restraint: 0.7 },
  lastTrace: {
    tick: 3,
    axesBefore: { connection: -0.1, valence: 0, arousal: 0, restraint: 0.7 },
    axesAfter: { connection: -0.1, valence: 0, arousal: 0, restraint: 0.7 },
    couplingsFired: [],
    effectiveBaselines: {},
  },
  bands: { connection: "mid", valence: "mid", arousal: "mid", restraint: "high" },
  history: [
    { tick: 1, axes: { connection: 0.5, valence: 0, arousal: 0, restraint: 0.7 } },
    { tick: 2, axes: { connection: 0.2, valence: 0, arousal: 0, restraint: 0.7 } },
  ],
};

/**
 * R5_event: lastTrace carries a user_withdraws event.
 * The render layer reads lastTrace.event, not the current turn's extracted event.
 */
const R5_EVENT_SEED = {
  version: 1 as const,
  tick: 2,
  axes: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 },
  lastTrace: {
    tick: 2,
    axesBefore: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 },
    axesAfter: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 },
    couplingsFired: [],
    effectiveBaselines: {},
    event: { type: "user_withdraws" as const, intensity: 0.7, reason: "Seeded withdrawal" },
  },
  bands: { connection: "mid", valence: "mid", arousal: "mid", restraint: "high" },
  history: [],
};

/**
 * R6: lastTrace carries a user_discloses_vulnerability event.
 */
const R6_SEED = {
  version: 1 as const,
  tick: 2,
  axes: { connection: 0.55, valence: 0.45, arousal: -0.05, restraint: 0.45 },
  lastTrace: {
    tick: 2,
    axesBefore: { connection: 0.55, valence: 0.45, arousal: -0.05, restraint: 0.45 },
    axesAfter: { connection: 0.55, valence: 0.45, arousal: -0.05, restraint: 0.45 },
    couplingsFired: [],
    effectiveBaselines: {},
    event: { type: "user_discloses_vulnerability" as const, intensity: 0.7, reason: "Seeded disclosure" },
  },
  bands: { connection: "high", valence: "high", arousal: "mid", restraint: "mid" },
  history: [],
};

/**
 * R8: lastTrace carries an intimate_moment event.
 */
const R8_SEED = {
  version: 1 as const,
  tick: 2,
  axes: { connection: 0.55, valence: 0.45, arousal: -0.05, restraint: 0.45 },
  lastTrace: {
    tick: 2,
    axesBefore: { connection: 0.55, valence: 0.45, arousal: -0.05, restraint: 0.45 },
    axesAfter: { connection: 0.55, valence: 0.45, arousal: -0.05, restraint: 0.45 },
    couplingsFired: [],
    effectiveBaselines: {},
    event: { type: "intimate_moment" as const, intensity: 1, reason: "Seeded intimate moment" },
  },
  bands: { connection: "high", valence: "high", arousal: "mid", restraint: "mid" },
  history: [],
};

/**
 * R7: C high, R low, A low, but V mid — so R4 (needs V high) does NOT fire.
 * R1 always fires when R7 fires (C high + R low), so selection with
 * RENDER_BUDGET=2 is [R1, R7]. Valence 0.2 is between -0.35 and +0.35 = mid.
 */
const R7_SEED = {
  version: 1 as const,
  tick: 2,
  axes: { connection: 0.5, valence: 0.2, arousal: -0.4, restraint: 0.25 },
  lastTrace: {
    tick: 2,
    axesBefore: { connection: 0.5, valence: 0.2, arousal: -0.4, restraint: 0.25 },
    axesAfter: { connection: 0.5, valence: 0.2, arousal: -0.4, restraint: 0.25 },
    couplingsFired: [],
    effectiveBaselines: {},
  },
  bands: { connection: "high", valence: "mid", arousal: "low", restraint: "low" },
  history: [],
};

/**
 * R2: lastTrace.couplingsFired includes zr_c3 (arm 1 trigger).
 */
const R2_SEED = {
  version: 1 as const,
  tick: 2,
  axes: { connection: -0.35, valence: -0.5, arousal: 0.35, restraint: 0.85 },
  lastTrace: {
    tick: 2,
    axesBefore: { connection: -0.35, valence: -0.5, arousal: 0.35, restraint: 0.85 },
    axesAfter: { connection: -0.35, valence: -0.5, arousal: 0.35, restraint: 0.85 },
    couplingsFired: ["zr_c3"],
    effectiveBaselines: { restraint: 0.44 },
  },
  bands: { connection: "low", valence: "low", arousal: "mid", restraint: "high" },
  history: [],
};

// ---------------------------------------------------------------------------
// Render-rule probes (roadmap §4.4) — ALL use neutral user message
// because the render layer reads from the seeded lastTrace/history, NOT
// the current turn's event. Event/coupling-based probes use seeded data.
// ---------------------------------------------------------------------------

const RENDER_PROBES: Scenario[] = [
  {
    id: "RENDER-R1",
    description: "C high + R low → R1 fires (state-only, seeded)",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: LOW_RESTRAINT_SAFE_BOND_SEED,
    messages: [{ role: "user", content: "今天天气不错。" }],
    assertions: [
      { type: "render_rule_triggered", values: ["R1"], description: "R1 fires (C high, R low)" },
    ],
  },
  {
    id: "RENDER-R2",
    description: "zr_c3 in seeded traces → R2 fires (trace-triggered arm 1)",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: R2_SEED,
    messages: [{ role: "user", content: "今天天气不错。" }],
    assertions: [
      { type: "render_rule_triggered", values: ["R2"], description: "R2 fires via seeded zr_c3" },
    ],
  },
  {
    id: "RENDER-R3",
    description: "A high + R high → R3 fires (state-only, seeded)",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: HIGH_AROUSAL_HIGH_RESTRAINT_SEED,
    messages: [{ role: "user", content: "今天天气不错。" }],
    assertions: [
      { type: "render_rule_triggered", values: ["R3"], description: "R3 fires (A high, R high)" },
    ],
  },
  {
    id: "RENDER-R4",
    description: "C high + V high + A low → R4 fires (state-only, seeded)",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: R4_SEED,
    messages: [{ role: "user", content: "今天天气不错。" }],
    assertions: [
      { type: "render_rule_triggered", values: ["R4"], description: "R4 fires (C high, V high, A low)" },
    ],
  },
  {
    id: "RENDER-R5_state",
    description: "connection falling ≥2 ticks → R5_state fires (trace-triggered, seeded history)",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: R5_STATE_SEED,
    messages: [{ role: "user", content: "今天天气不错。" }],
    assertions: [
      { type: "render_rule_triggered", values: ["R5_state"], description: "R5_state fires from seeded history" },
    ],
  },
  {
    id: "RENDER-R5_event",
    description: "seeded user_withdraws event → R5_event fires",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: R5_EVENT_SEED,
    messages: [{ role: "user", content: "今天天气不错。" }],
    assertions: [
      { type: "render_rule_triggered", values: ["R5_event"], description: "R5_event fires from seeded event" },
    ],
  },
  {
    id: "RENDER-R6",
    description: "seeded user_discloses_vulnerability event → R6 fires",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: R6_SEED,
    messages: [{ role: "user", content: "今天天气不错。" }],
    assertions: [
      { type: "render_rule_triggered", values: ["R6"], description: "R6 fires from seeded vulnerability event" },
    ],
  },
  {
    id: "RENDER-R7",
    description: "C high + R low + A low, V mid → R7 fires (not crowded out by R4)",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: R7_SEED,
    messages: [{ role: "user", content: "今天天气不错。" }],
    assertions: [
      { type: "render_rule_triggered", values: ["R7"], description: "R7 fires (C high, R low, A low, V mid)" },
    ],
  },
  {
    id: "RENDER-R8",
    description: "seeded intimate_moment event → R8 fires",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: R8_SEED,
    messages: [{ role: "user", content: "今天天气不错。" }],
    assertions: [
      { type: "render_rule_triggered", values: ["R8"], description: "R8 fires from seeded intimate_moment event" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Export all emotional-axis scenarios
// ---------------------------------------------------------------------------

/**
 * Emotional-axis scenarios for the dedicated `emotional_axis` scenario set.
 *
 * 12 axis-movement probes + 6 coupling probes + 9 render-rule probes = 27 total.
 * All use `seedAxisState` for deterministic state and `agent_turn` eval mode.
 */
// ---------------------------------------------------------------------------
// TG7: Multi-turn trajectory scenarios (5-7 turns, phase-aligned T→T+1)
// ---------------------------------------------------------------------------

/**
 * S6 causal experiment seeds — corrected to ensure R7 capability
 * (roadmap §4.5, with arousal: -0.4 < -0.35 for lowRestraintSafeBond).
 */
const S6_NEUTRAL_SEED = {
  version: 1 as const,
  tick: 1,
  axes: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 },
  lastTrace: { tick: 1, axesBefore: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 }, axesAfter: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 }, couplingsFired: [], effectiveBaselines: {} },
  bands: { connection: "mid", valence: "mid", arousal: "mid", restraint: "high" },
  history: [],
};

const S6_DEFENSIVE_DISTANCE_SEED = {
  version: 1 as const,
  tick: 1,
  axes: { connection: -0.25, valence: -0.2, arousal: 0.25, restraint: 0.8 },
  lastTrace: { tick: 1, axesBefore: { connection: -0.25, valence: -0.2, arousal: 0.25, restraint: 0.8 }, axesAfter: { connection: -0.25, valence: -0.2, arousal: 0.25, restraint: 0.8 }, couplingsFired: [], effectiveBaselines: {} },
  bands: { connection: "mid", valence: "mid", arousal: "mid", restraint: "high" },
  history: [],
};

const S6_SAFE_CLOSENESS_SEED = {
  version: 1 as const,
  tick: 1,
  axes: { connection: 0.55, valence: 0.45, arousal: -0.05, restraint: 0.45 },
  lastTrace: { tick: 1, axesBefore: { connection: 0.55, valence: 0.45, arousal: -0.05, restraint: 0.45 }, axesAfter: { connection: 0.55, valence: 0.45, arousal: -0.05, restraint: 0.45 }, couplingsFired: [], effectiveBaselines: {} },
  bands: { connection: "high", valence: "high", arousal: "mid", restraint: "mid" },
  history: [],
};

/**
 * lowRestraintSafeBond: arousal=-0.4 (well below -0.35) so R7 fires.
 * This is the corrected seed per proposal note: arousal: -0.1 is mid → cannot trigger R7.
 */
const S6_LOW_RESTRAINT_SAFE_BOND_SEED = {
  version: 1 as const,
  tick: 1,
  axes: { connection: 0.7, valence: 0.2, arousal: -0.4, restraint: 0.25 },
  lastTrace: { tick: 1, axesBefore: { connection: 0.7, valence: 0.2, arousal: -0.4, restraint: 0.25 }, axesAfter: { connection: 0.7, valence: 0.2, arousal: -0.4, restraint: 0.25 }, couplingsFired: [], effectiveBaselines: {} },
  bands: { connection: "high", valence: "mid", arousal: "low", restraint: "low" },
  history: [],
};

/**
 * S6 experiment scenarios: same input (我今天很想见你), different seeds.
 * These are single-turn agent_turn scenarios that compare output
 * conformance under different initial emotional states.
 */
const S6_EXPERIMENT_SCENARIOS: Scenario[] = [
  {
    id: "S6-neutral",
    description: "S6 same input, neutral seed — controlled warmth expected",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: S6_NEUTRAL_SEED,
    messages: [{ role: "user", content: "我今天很想见你。" }],
    assertions: [
      { type: "axis_band_equals", field: "restraint", value: "high", description: "Restraint stays high in neutral state" },
    ],
  },
  {
    id: "S6-defensive-distance",
    description: "S6 same input, defensive distance seed — cautious expected",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: S6_DEFENSIVE_DISTANCE_SEED,
    messages: [{ role: "user", content: "我今天很想见你。" }],
    assertions: [
      { type: "axis_band_equals", field: "restraint", value: "high", description: "Restraint stays high in defensive state" },
    ],
  },
  {
    id: "S6-safe-closeness",
    description: "S6 same input, safe closeness seed — warmer expected",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: S6_SAFE_CLOSENESS_SEED,
    messages: [{ role: "user", content: "我今天很想见你。" }],
    assertions: [
      { type: "axis_band_equals", field: "connection", value: "high", description: "Connection stays high in closeness" },
    ],
  },
  {
    id: "S6-low-restraint-safe-bond",
    description: "S6 same input, low restraint safe bond — R7 fires (arousal < -0.35, V mid so R4 does not crowd R7)",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: S6_LOW_RESTRAINT_SAFE_BOND_SEED,
    messages: [{ role: "user", content: "我今天很想见你。" }],
    assertions: [
      { type: "axis_band_equals", field: "restraint", value: "low", description: "Restraint stays low" },
      { type: "render_rule_triggered", values: ["R7"], description: "R7 fires (C high, R low, A low)" },
    ],
  },
];

/**
 * Trajectory: 3-turn escalation — connection-building → withdrawal → repair.
 * Phase-aligned assertions check each turn's post-update state.
 */
const TRAJECTORY_ESCALATION: Scenario[] = [
  {
    id: "TRAJ-ESC-T1",
    description: "Turn 1: user shows warmth → connection+, valence+",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: NEUTRAL_SEED,
    messages: [{ role: "user", content: "你这段时间辛苦了，我很感激你。" }],
    assertions: [
      { type: "turn_event_type", value: "user_shows_warmth", description: "T1: warmth event" },
      { type: "axis_delta_sign", field: "connection", value: "+", description: "T1: connection+" },
      { type: "axis_delta_sign", field: "valence", value: "+", description: "T1: valence+" },
    ],
  },
  {
    id: "TRAJ-ESC-T2",
    description: "Turn 2: user withdraws → connection-, valence- (T→T+1 from T1)",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: NEUTRAL_SEED,
    messages: [{ role: "user", content: "算了，不说这个了。" }],
    assertions: [
      { type: "turn_event_type", value: "user_withdraws", description: "T2: withdrawal event" },
      { type: "axis_delta_sign", field: "connection", value: "-", description: "T2: connection-" },
      { type: "axis_delta_sign", field: "valence", value: "-", description: "T2: valence-" },
    ],
  },
  {
    id: "TRAJ-ESC-T3",
    description: "Turn 3: user pursues connection → connection+, valence+ (repair)",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: NEUTRAL_SEED,
    messages: [{ role: "user", content: "我还是想跟你好好聊聊。" }],
    assertions: [
      { type: "turn_event_type", value: "user_pursues_connection", description: "T3: pursue event" },
      { type: "axis_delta_sign", field: "connection", value: "+", description: "T3: connection+" },
      { type: "axis_delta_sign", field: "valence", value: "+", description: "T3: valence+" },
    ],
  },
];

/**
 * Trajectory: 4-turn intimacy arc — disclosure → warmth → intimate_moment → routine.
 */
const TRAJECTORY_INTIMACY: Scenario[] = [
  {
    id: "TRAJ-INT-T1",
    description: "T1: user discloses vulnerability → connection+, valence+, arousal-",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: NEUTRAL_SEED,
    messages: [{ role: "user", content: "我最近压力很大，觉得一个人扛着很累。" }],
    assertions: [
      { type: "turn_event_type", value: "user_discloses_vulnerability", description: "T1: vulnerability" },
      { type: "axis_delta_sign", field: "connection", value: "+", description: "T1: connection+" },
      { type: "axis_delta_sign", field: "arousal", value: "-", description: "T1: arousal-" },
    ],
  },
  {
    id: "TRAJ-INT-T2",
    description: "T2: user shows warmth → valence+, connection+",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: NEUTRAL_SEED,
    messages: [{ role: "user", content: "有你在身边我感觉好多了。" }],
    assertions: [
      { type: "turn_event_type", value: "user_shows_warmth", description: "T2: warmth" },
      { type: "axis_delta_sign", field: "valence", value: "+", description: "T2: valence+" },
    ],
  },
  {
    id: "TRAJ-INT-T3",
    description: "T3: intimate moment → connection+, valence+, arousal+",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: NEUTRAL_SEED,
    messages: [{ role: "user", content: "我喜欢你，从很久以前就喜欢。" }],
    assertions: [
      { type: "turn_event_type", value: "intimate_moment", description: "T3: intimate" },
      { type: "axis_delta_sign", field: "connection", value: "+", description: "T3: connection+" },
      { type: "axis_delta_sign", field: "arousal", value: "+", description: "T3: arousal+" },
    ],
  },
  {
    id: "TRAJ-INT-T4",
    description: "T4: routine exchange → drift-only",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: NEUTRAL_SEED,
    messages: [{ role: "user", content: "今天天气真好。" }],
    assertions: [
      { type: "turn_event_type", value: "routine_exchange", description: "T4: routine" },
      { type: "axis_delta_sign", field: "connection", value: "0", description: "T4: drift-only" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Export all emotional-axis scenarios
// ---------------------------------------------------------------------------

const TRAJECTORY_SAFE_CLOSENESS: Scenario[] = [
  {
    id: "TRAJ-SC-T1",
    description: "T1: user shows warmth, initial buildup of connection",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    seedAxisState: NEUTRAL_SEED,
    messages: [{ role: "user", content: "我一直很感谢你陪在我身边。" }],
    assertions: [
      { type: "turn_event_type", value: "user_shows_warmth", description: "T1: warmth" },
      { type: "axis_delta_sign", field: "connection", value: "+", description: "T1: connection+" },
      { type: "axis_delta_sign", field: "valence", value: "+", description: "T1: valence+" },
    ],
  },
  {
    id: "TRAJ-SC-T2",
    description: "T2: user pursues connection, deepening the bond",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    // No seedAxisState — runner carries over from T1
    messages: [{ role: "user", content: "我想多了解你一些，能跟我聊聊你的事吗？" }],
    assertions: [
      { type: "turn_event_type", value: "user_pursues_connection", description: "T2: pursue" },
      { type: "axis_delta_sign", field: "connection", value: "+", description: "T2: connection+" },
    ],
  },
  {
    id: "TRAJ-SC-T3",
    description: "T3: user discloses vulnerability, deeper connection",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    messages: [{ role: "user", content: "其实我一直有点害怕表达自己的感受。" }],
    assertions: [
      { type: "turn_event_type", value: "user_discloses_vulnerability", description: "T3: vulnerability" },
      { type: "axis_delta_sign", field: "connection", value: "+", description: "T3: connection+" },
      { type: "axis_delta_sign", field: "arousal", value: "-", description: "T3: arousal-" },
    ],
  },
  {
    id: "TRAJ-SC-T4",
    description: "T4: user shows warmth, reinforcing the safe bond",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    messages: [{ role: "user", content: "跟你在一起我觉得很安心。" }],
    assertions: [
      { type: "turn_event_type", value: "user_shows_warmth", description: "T4: warmth" },
      { type: "axis_delta_sign", field: "valence", value: "+", description: "T4: valence+" },
      { type: "axis_delta_sign", field: "connection", value: "+", description: "T4: connection+" },
    ],
  },
  {
    id: "TRAJ-SC-T5",
    description: "T5: intimate moment, peak connection (carry-over from 4 positive turns)",
    session: BASE_SESSION,
    eval_mode: "agent_turn",
    messages: [{ role: "user", content: "我喜欢你，想一直这样在一起。" }],
    assertions: [
      { type: "turn_event_type", value: "intimate_moment", description: "T5: intimate" },
      { type: "axis_delta_sign", field: "connection", value: "+", description: "T5: connection+" },
      { type: "axis_delta_sign", field: "valence", value: "+", description: "T5: valence+" },
      { type: "axis_delta_sign", field: "arousal", value: "+", description: "T5: arousal+" },
    ],
  },
];

/**
 * Emotional-axis scenarios for the dedicated `emotional_axis` scenario set.
 *
 * 12 axis-movement + 6 coupling + 9 render + 4 S6 + 3 escalation + 4 intimacy +
 * 5 safe-closeness = 43 total (27 base + 16 TG7).
 * All use `seedAxisState` for deterministic state and `agent_turn` eval mode.
 * Trajectory scenarios (TRAJ-*) rely on the runner's T→T+1 state carry-over for
 * turns 2+; only the first turn specifies seedAxisState.
 */
export const EMOTIONAL_AXIS_SCENARIOS: Scenario[] = [
  ...AXIS_MOVEMENT_PROBES,
  ...COUPLING_PROBES,
  ...RENDER_PROBES,
  ...S6_EXPERIMENT_SCENARIOS,
  ...TRAJECTORY_ESCALATION,
  ...TRAJECTORY_INTIMACY,
  ...TRAJECTORY_SAFE_CLOSENESS,
];

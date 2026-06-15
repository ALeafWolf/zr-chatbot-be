import { and, desc, eq, isNull } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { env } from "../../config/env";
import { db } from "../../db/client";
import { chatMessages, chatSessions, sessionState } from "../../db/schema/chat";
import { loadCharacterDefaults, loadPersonaOverlay } from "../../character/characterDefaults";
import { listCharacters } from "../../character/characterProfiles";
import { WRITEBACK_POLICY_BY_MODE } from "../../character/canonRules";
import { buildMemoryNamespace } from "../../memory/shared/memoryNamespace";
import { AVAILABLE_SCOPES } from "../../retrieval/scope/resolveContinuityScope";
import { getSessionState } from "../../state/sessionStateRepo";
import { readAxisState } from "../../state/emotionalEngine/axisStatePersistence";
import { resolveAxesConfigForScope } from "../../state/emotionalEngine/resolveAxesConfigForScope";
import { computeBands } from "../../state/emotionalEngine/bands";
import type { AxisName, AxesConfig, Band, CharacterStateAxes } from "../../state/emotionalEngine/types";
import type {
  CreateSessionInput,
  GetMessagesQueryInput,
  PatchSessionInput,
} from "./sessionSchemas";
import {
  serializeSessionDetail,
  serializeSessionListItem,
} from "./sessionSerializers";

// ---------------------------------------------------------------------------
// Axis-State DTO (design A2)
// ---------------------------------------------------------------------------

export interface AxisStateDTO {
  session_id: string;
  enabled: boolean;
  source: "persisted" | "baseline";
  scope: string;
  tick: number;
  axes: CharacterStateAxes;
  bands: Record<AxisName, Band>;
  baselines: CharacterStateAxes;
  history: { tick: number; axes: CharacterStateAxes }[];
  last_trace: {
    event: { type: string; intensity: number } | null;
    couplings_fired: string[];
    effective_baselines: Partial<CharacterStateAxes>;
  } | null;
  updated_at: string;
  /** Per-coupling Chinese label/description (config, not state). Always present. */
  coupling_glossary: Record<string, { label: string; description: string }>;
}

/**
 * Build a coupling_glossary from emotional_coupling array (design T2).
 * Returns one entry per coupling that has a label; description defaults to "".
 * Empty {} when no couplings.
 */
function buildCouplingGlossary(
  couplings: Array<{ id: string; label?: string; description?: string }> | undefined,
): Record<string, { label: string; description: string }> {
  if (!couplings) return {};
  const glossary: Record<string, { label: string; description: string }> = {};
  for (const c of couplings) {
    if (c.label) {
      glossary[c.id] = { label: c.label, description: c.description ?? "" };
    }
  }
  return glossary;
}

/** Fallback axes config when the character has no emotional_axes block. */
const FALLBACK_AXES: AxesConfig = {
  connection: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
  valence: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
  arousal: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
  restraint: { baseline: 0.7, driftRate: 0.02, min: -1, max: 1 },
};

export async function listCharacterOptions() {
  const chars = await listCharacters();
  return chars.map((c) => ({ character_id: c.characterId, name: c.name }));
}

export function listScopeOptions() {
  return AVAILABLE_SCOPES.map((scope) => ({ scope }));
}

export function listModeOptions() {
  return ["canonical_live", "pinned_scenario", "sandbox"];
}

export async function createSession(body: CreateSessionInput) {
  const playerId = env.DEFAULT_PLAYER_ID;
  const memoryNamespace = buildMemoryNamespace({
    continuityFamily: "main_world",
    scope: body.continuity_scope,
    playerId,
  });

  let personaOverlayId: string | null = null;
  try {
    loadPersonaOverlay(body.continuity_scope);
    personaOverlayId = body.continuity_scope;
  } catch {
    personaOverlayId = null;
  }

  const sessionId = uuidv4();
  const writebackPolicy =
    WRITEBACK_POLICY_BY_MODE[body.mode] ?? "no_writeback";
  const now = new Date();

  await db.insert(chatSessions).values({
    sessionId,
    characterId: body.character_id,
    playerId,
    mode: body.mode,
    continuityScope: body.continuity_scope,
    continuityFamily: "main_world",
    personaOverlayId,
    memoryNamespace,
    pinnedTime: body.pinned_time ?? null,
    pinnedLocation: body.pinned_location ?? null,
    writebackPolicy,
    displayTitle: body.display_title ?? null,
    thinking: body.thinking ?? env.DEFAULT_SESSION_THINKING,
    temperature: body.temperature ?? env.DEFAULT_SESSION_TEMPERATURE,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(sessionState).values({
    sessionId,
    lastTurnIndex: 0,
    updatedAt: now,
  });

  return { session_id: sessionId };
}

export async function listSessions() {
  const sessions = await db
    .select({
      sessionId: chatSessions.sessionId,
      characterId: chatSessions.characterId,
      mode: chatSessions.mode,
      continuityScope: chatSessions.continuityScope,
      sessionSummary: chatSessions.sessionSummary,
      displayTitle: chatSessions.displayTitle,
      thinking: chatSessions.thinking,
      temperature: chatSessions.temperature,
      createdAt: chatSessions.createdAt,
      updatedAt: chatSessions.updatedAt,
    })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.playerId, env.DEFAULT_PLAYER_ID),
        isNull(chatSessions.deletedAt),
      ),
    )
    .orderBy(desc(chatSessions.updatedAt))
    .limit(100);

  return sessions.map(serializeSessionListItem);
}

export async function patchSession(id: string, body: PatchSessionInput) {
  const existing = await db
    .select({ sessionId: chatSessions.sessionId })
    .from(chatSessions)
    .where(and(eq(chatSessions.sessionId, id), isNull(chatSessions.deletedAt)))
    .limit(1);

  if (!existing[0]) return null;

  const setVals: Partial<{
    displayTitle: string | null;
    thinking: boolean;
    temperature: number;
    updatedAt: Date;
  }> = { updatedAt: new Date() };
  if (body.display_title !== undefined) {
    setVals.displayTitle = body.display_title ?? null;
  }
  if (body.thinking !== undefined) setVals.thinking = body.thinking;
  if (body.temperature !== undefined) setVals.temperature = body.temperature;

  await db
    .update(chatSessions)
    .set(setVals)
    .where(eq(chatSessions.sessionId, id));

  const [row] = await db
    .select({
      displayTitle: chatSessions.displayTitle,
      thinking: chatSessions.thinking,
      temperature: chatSessions.temperature,
    })
    .from(chatSessions)
    .where(eq(chatSessions.sessionId, id))
    .limit(1);

  return {
    session_id: id,
    display_title: row?.displayTitle ?? null,
    thinking: row?.thinking ?? true,
    temperature: row?.temperature ?? 1,
  };
}

export async function getSession(id: string, query: GetMessagesQueryInput) {
  const [sessionRows, messageRowsNewestFirst] = await Promise.all([
    db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.sessionId, id), isNull(chatSessions.deletedAt)))
      .limit(1),
    db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, id))
      .orderBy(desc(chatMessages.turnIndex))
      .limit(query.page_size)
      .offset(query.page * query.page_size),
  ]);

  const session = sessionRows[0];
  if (!session) return null;
  return serializeSessionDetail(session, [...messageRowsNewestFirst].reverse());
}

export async function deleteSession(id: string): Promise<void> {
  await db
    .update(chatSessions)
    .set({ deletedAt: new Date() })
    .where(eq(chatSessions.sessionId, id));
}

// ---------------------------------------------------------------------------
// Axis-state read (TG1)
// ---------------------------------------------------------------------------

/**
 * Get the current emotional axis state for a session.
 *
 * Returns the persisted axis_state when available, otherwise resolves
 * scope baselines (same fallback the engine uses). Returns null when the
 * session does not exist. Never throws on absent/corrupt axis state
 * (degrades to baselines per design A4).
 */
export async function getAxisState(sessionId: string): Promise<AxisStateDTO | null> {
  // 1. Verify session exists and grab scope + character
  const [sessionRow] = await db
    .select({
      characterId: chatSessions.characterId,
      continuityScope: chatSessions.continuityScope,
      updatedAt: chatSessions.updatedAt,
    })
    .from(chatSessions)
    .where(and(eq(chatSessions.sessionId, sessionId), isNull(chatSessions.deletedAt)))
    .limit(1);

  if (!sessionRow) return null;

  const { characterId, continuityScope: scope } = sessionRow;

  // 2. Load character defaults for emotional_axes config + coupling glossary
  let axesConfig: AxesConfig;
  let baselineOverrides;
  let couplingGlossary: Record<string, { label: string; description: string }> = {};
  try {
    const defaults = loadCharacterDefaults(characterId);
    axesConfig = defaults.emotional_axes ?? FALLBACK_AXES;
    baselineOverrides = defaults.emotional_axes_baseline_by_scope;
    couplingGlossary = buildCouplingGlossary(defaults.emotional_coupling);
  } catch {
    axesConfig = FALLBACK_AXES;
    baselineOverrides = undefined;
    // couplingGlossary stays {}
  }

  // 3. Resolve scope baselines (always included in DTO)
  const scopeConfig = resolveAxesConfigForScope(axesConfig, baselineOverrides, scope);
  const baselines: CharacterStateAxes = {
    connection: scopeConfig.connection.baseline,
    valence: scopeConfig.valence.baseline,
    arousal: scopeConfig.arousal.baseline,
    restraint: scopeConfig.restraint.baseline,
  };

  const enabled = env.EMOTIONAL_ENGINE_ENABLED;

  // Shared glossary — config, not state; included in all returns
  const sharedGlossary = couplingGlossary;

  // 4. When engine is off, return baselines immediately (spec requirement)
  if (!enabled) {
    const allMid: Record<AxisName, Band> = { connection: "mid", valence: "mid", arousal: "mid", restraint: "mid" };
    const bands = computeBands(baselines, allMid);
    return {
      session_id: sessionId,
      enabled: false,
      source: "baseline",
      scope,
      tick: 0,
      axes: baselines,
      bands,
      baselines,
      history: [],
      last_trace: null,
      updated_at: (sessionRow.updatedAt ?? new Date()).toISOString(),
      coupling_glossary: sharedGlossary,
    };
  }

  // 5. Try persisted axis state
  let stateRow = null;
  try {
    stateRow = await getSessionState(sessionId);
  } catch {
    // DB error — degrade to baselines gracefully
    stateRow = null;
  }

  let persisted;
  try {
    persisted = readAxisState(stateRow);
  } catch {
    persisted = null;
  }

  if (persisted) {
    // Compact the last_trace: drop reason, snake_case couplings
    const traceEvent = persisted.lastTrace.event
      ? { type: persisted.lastTrace.event.type, intensity: persisted.lastTrace.event.intensity }
      : null;

    return {
      session_id: sessionId,
      enabled: true,
      source: "persisted",
      scope,
      tick: persisted.tick,
      axes: persisted.axes,
      bands: persisted.bands,
      baselines,
      history: persisted.history.map((h) => ({ tick: h.tick, axes: h.axes })),
      last_trace: {
        event: traceEvent,
        couplings_fired: persisted.lastTrace.couplingsFired,
        effective_baselines: persisted.lastTrace.effectiveBaselines,
      },
      updated_at: (stateRow?.updatedAt ?? new Date()).toISOString(),
      coupling_glossary: sharedGlossary,
    };
  }

  // 6. Baseline fallback (fresh session / corrupt / absent)
  const allMid: Record<AxisName, Band> = { connection: "mid", valence: "mid", arousal: "mid", restraint: "mid" };
  const bands = computeBands(baselines, allMid);

  return {
    session_id: sessionId,
    enabled: true,
    source: "baseline",
    scope,
    tick: 0,
    axes: baselines,
    bands,
    baselines,
    history: [],
    last_trace: null,
    updated_at: (stateRow?.updatedAt ?? sessionRow.updatedAt ?? new Date()).toISOString(),
    coupling_glossary: sharedGlossary,
  };
}

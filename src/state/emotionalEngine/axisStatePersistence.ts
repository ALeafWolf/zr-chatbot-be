// ---------------------------------------------------------------------------
// axisStatePersistence — Read/write helpers for the versioned axis_state
// sub-object inside session_state.local_relationship_delta (JSONB).
//
// Design D2: versioned, merge-preserving, bounded history (cap 6).
// ---------------------------------------------------------------------------

import { db } from "../../db/client";
import { chatMessages, sessionState as sessionStateTable } from "../../db/schema/chat";
import { eq } from "drizzle-orm";
import { getSessionState, upsertSessionState } from "../sessionStateRepo";
import type { SessionState } from "../../db/schema/chat";
import type {
  PersistedAxisState,
  AxisName,
  Band,
  CharacterStateAxes,
  TurnEventType,
  ConditionTransition,
  EmotionalAxisTurnExportSnapshot,
} from "./types";
import { HISTORY_CAP } from "./constants";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AXIS_STATE_KEY = "axis_state";
const CURRENT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Typed error for missing assistant message (F1)
// ---------------------------------------------------------------------------

/**
 * Thrown by `persistAxisSnapshot` / `persistAxisSnapshotTx` when the
 * `chat_messages.emotional_axis` update matches no row. Callers (e.g.
 * `applyEngineStateNode` in `postTurnMemoryGraph.ts`) should check for this
 * error type and NOT mark the engine step complete when it is caught.
 */
export class MissingAssistantMessageError extends Error {
  constructor(
    public readonly assistantMessageId: string,
    public readonly sessionId: string,
  ) {
    super(
      `persistAxisSnapshot: assistant message "${assistantMessageId}" not found in session "${sessionId}". ` +
      `The session_state update has been rolled back.`,
    );
    this.name = "MissingAssistantMessageError";
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read axis state from a session state row.
 *
 * @param row - Raw session state row from the DB (or null if no row exists).
 * @returns Parsed `PersistedAxisState` or `null` when:
 *   - row is null / has no `localRelationshipDelta`
 *   - the `axis_state` key is missing, unparseable, or has a version mismatch
 *   - `lastTrace` structure is invalid (F4: option a — treat as corrupt)
 */
export function readAxisState(
  row: SessionState | null,
): PersistedAxisState | null {
  if (!row?.localRelationshipDelta) return null;

  const delta = row.localRelationshipDelta as Record<string, unknown>;
  const raw = delta[AXIS_STATE_KEY];
  if (!raw) return null;

  // Attempt typed parse
  return parsePersistedAxisState(raw);
}

/**
 * Internal parse with error handling.
 * Exported for unit-test access.
 */
export function parsePersistedAxisState(
  raw: unknown,
): PersistedAxisState | null {
  if (typeof raw !== "object" || raw === null) {
    console.warn("[axisStatePersistence] axis_state is not an object — treating as absent");
    return null;
  }

  const obj = raw as Record<string, unknown>;

  // Version check
  if (obj.version !== CURRENT_VERSION) {
    console.warn(
      `[axisStatePersistence] axis_state version mismatch: expected ${CURRENT_VERSION}, got ${String(obj.version)} — treating as absent`,
    );
    return null;
  }

  // -----------------------------------------------------------------------
  // F4 — validate lastTrace structure (option a: treat as corrupt)
  // -----------------------------------------------------------------------
  const trace = obj.lastTrace;
  if (
    typeof trace !== "object" ||
    trace === null ||
    !Array.isArray((trace as Record<string, unknown>).couplingsFired) ||
    typeof (trace as Record<string, unknown>).effectiveBaselines !== "object" ||
    (trace as Record<string, unknown>).effectiveBaselines === null
  ) {
    console.warn(
      "[axisStatePersistence] axis_state.lastTrace is missing or malformed (couplingsFired/effectiveBaselines) — treating as absent",
    );
    return null;
  }

  // -----------------------------------------------------------------------
  // Coerce required fields with basic shape validation.
  // -----------------------------------------------------------------------
  try {
    const state: PersistedAxisState = {
      version: CURRENT_VERSION,
      tick: safeNumber(obj.tick, 0),
      axes: {
        connection: safeNumber((obj.axes as Record<string, unknown>)?.connection, 0),
        valence: safeNumber((obj.axes as Record<string, unknown>)?.valence, 0),
        arousal: safeNumber((obj.axes as Record<string, unknown>)?.arousal, 0),
        restraint: safeNumber((obj.axes as Record<string, unknown>)?.restraint, 0),
      },
      lastTrace: trace as PersistedAxisState["lastTrace"],
      bands: {
        connection: safeBand((obj.bands as Record<string, unknown>)?.connection),
        valence: safeBand((obj.bands as Record<string, unknown>)?.valence),
        arousal: safeBand((obj.bands as Record<string, unknown>)?.arousal),
        restraint: safeBand((obj.bands as Record<string, unknown>)?.restraint),
      },
      history: Array.isArray(obj.history) ? obj.history.slice(-HISTORY_CAP) : [],
    };

    return state;
  } catch (err) {
    console.warn(
      `[axisStatePersistence] Failed to parse axis_state: ${(err as Error).message} — treating as absent`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pure merge helper (F5)
// ---------------------------------------------------------------------------

/**
 * Merge a new axis state into an existing local_relationship_delta,
 * preserving all sibling keys and enforcing the history cap.
 *
 * Pure function — no I/O, no side effects.
 *
 * @param existingDelta - The current `local_relationship_delta` object (may be empty).
 * @param next          - The new axis state to write.
 * @returns A new merged delta object suitable for `upsertSessionState`.
 */
export function mergeAxisStateIntoDelta(
  existingDelta: Record<string, unknown>,
  next: PersistedAxisState,
): Record<string, unknown> {
  const trimmed: PersistedAxisState = {
    ...next,
    history: next.history.slice(-HISTORY_CAP),
  };

  return {
    ...existingDelta,
    [AXIS_STATE_KEY]: trimmed,
  };
}

// ---------------------------------------------------------------------------
// Write (F3: production-safe default, F5: thin I/O wrapper)
// ---------------------------------------------------------------------------

/**
 * Write (merge-preserve) axis state into session_state.local_relationship_delta.
 *
 * Reads the current row to merge with existing keys, then writes the combined
 * object back. This ensures other sub-keys in `local_relationship_delta` are
 * never lost.
 *
 * @param sessionId - Target session.
 * @param next       - The next axis state to persist.
 * @param getSessionStateFn - Injectable for unit tests; defaults to real `getSessionState`.
 */
export async function writeAxisState(
  sessionId: string,
  next: PersistedAxisState,
  getSessionStateFn: (id: string) => Promise<SessionState | null> = getSessionState,
): Promise<void> {
  const row = await getSessionStateFn(sessionId);
  const existingDelta: Record<string, unknown> =
    row?.localRelationshipDelta
      ? (row.localRelationshipDelta as Record<string, unknown>)
      : {};

  const merged = mergeAxisStateIntoDelta(existingDelta, next);

  await upsertSessionState(sessionId, {
    localRelationshipDelta: merged,
  });
}

// ---------------------------------------------------------------------------
// TG1: Export snapshot builder
// ---------------------------------------------------------------------------

/**
 * Build a versioned `EmotionalAxisTurnExportSnapshot` from the post-turn
 * engine compute result. Caller provides the values already available in
 * `applyEngineStateNode` after `computeEngineAdvance`.
 */
export function buildAxisTurnExportSnapshot(input: {
  tick: number;
  scope: string;
  axes: CharacterStateAxes;
  bands: Record<AxisName, Band>;
  axesBefore: CharacterStateAxes;
  eventType?: TurnEventType;
  eventIntensity?: number;
  eventDeltas?: Partial<CharacterStateAxes>;
  couplingsFired?: string[];
  effectiveBaselines?: Partial<CharacterStateAxes>;
  conditionTransitions?: ConditionTransition[];
  resolvedBaselines?: CharacterStateAxes;
}): EmotionalAxisTurnExportSnapshot {
  const snapshot: EmotionalAxisTurnExportSnapshot = {
    version: 1,
    source: "post_turn_engine",
    tick: input.tick,
    scope: input.scope,
    axes: { ...input.axes },
    bands: { ...input.bands },
    axes_before: input.axesBefore ? { ...input.axesBefore } : undefined,
  };

  if (input.eventType !== undefined) {
    snapshot.event_type = input.eventType;
  }
  if (input.eventIntensity !== undefined) {
    snapshot.event_intensity = input.eventIntensity;
  }
  if (input.eventDeltas !== undefined && Object.keys(input.eventDeltas).length > 0) {
    snapshot.event_deltas = { ...input.eventDeltas };
  }
  if (input.couplingsFired !== undefined && input.couplingsFired.length > 0) {
    snapshot.couplings_fired = [...input.couplingsFired];
  }
  if (input.effectiveBaselines !== undefined && Object.keys(input.effectiveBaselines).length > 0) {
    snapshot.effective_baselines = { ...input.effectiveBaselines };
  }
  if (input.conditionTransitions !== undefined && input.conditionTransitions.length > 0) {
    snapshot.condition_transitions = input.conditionTransitions.map((ct) => ({ ...ct }));
  }
  if (input.resolvedBaselines !== undefined) {
    snapshot.resolved_baselines = { ...input.resolvedBaselines };
  }

  return snapshot;
}

// ---------------------------------------------------------------------------
// TG1: Export snapshot normalizer (safe for malformed stored JSON)
// ---------------------------------------------------------------------------

/**
 * Normalize an unknown stored value into an `EmotionalAxisTurnExportSnapshot`
 * for export formatting. Returns `null` when the value is null, missing,
 * version-mismatched, or structurally invalid, so malformed historical data
 * never breaks the export.
 */
export function normalizeAxisTurnExportSnapshot(
  raw: unknown,
): EmotionalAxisTurnExportSnapshot | null {
  if (!raw || typeof raw !== "object") return null;

  const obj = raw as Record<string, unknown>;

  // Version check
  if (obj.version !== 1) return null;
  if (obj.source !== "post_turn_engine") return null;

  // Required numeric tick
  const tick = safeNumber(obj.tick, -1);
  if (tick < 0) return null;

  // Required scope string
  if (typeof obj.scope !== "string" || obj.scope.length === 0) return null;

  // Required axes — all four must be finite numbers
  const axesRaw = obj.axes;
  if (!axesRaw || typeof axesRaw !== "object") return null;
  const ax = axesRaw as Record<string, unknown>;
  const connection = ax.connection;
  const valence = ax.valence;
  const arousal = ax.arousal;
  const restraint = ax.restraint;
  if (
    typeof connection !== "number" || !Number.isFinite(connection) ||
    typeof valence !== "number" || !Number.isFinite(valence) ||
    typeof arousal !== "number" || !Number.isFinite(arousal) ||
    typeof restraint !== "number" || !Number.isFinite(restraint)
  ) {
    return null;
  }
  const axes: CharacterStateAxes = {
    connection,
    valence,
    arousal,
    restraint,
  };

  // Required bands — all four must be valid labels
  const bandsRaw = obj.bands;
  if (!bandsRaw || typeof bandsRaw !== "object") return null;
  const br = bandsRaw as Record<string, unknown>;
  const bConn = br.connection;
  const bVal = br.valence;
  const bAro = br.arousal;
  const bRes = br.restraint;
  if (
    !isValidBand(bConn) ||
    !isValidBand(bVal) ||
    !isValidBand(bAro) ||
    !isValidBand(bRes)
  ) {
    return null;
  }
  const bands: Record<AxisName, Band> = {
    connection: bConn as Band,
    valence: bVal as Band,
    arousal: bAro as Band,
    restraint: bRes as Band,
  };

  return {
    version: 1,
    source: "post_turn_engine",
    tick,
    scope: obj.scope as string,
    axes,
    bands,
    axes_before: safeCharacterStateAxes(obj.axes_before),
    event_type: typeof obj.event_type === "string" ? (obj.event_type as TurnEventType) : undefined,
    event_intensity: typeof obj.event_intensity === "number" && Number.isFinite(obj.event_intensity) ? obj.event_intensity : undefined,
    event_deltas: safePartialCharacterStateAxes(obj.event_deltas),
    couplings_fired: Array.isArray(obj.couplings_fired) ? obj.couplings_fired.map(String) : undefined,
    effective_baselines: safePartialCharacterStateAxes(obj.effective_baselines),
    condition_transitions: Array.isArray(obj.condition_transitions)
      ? obj.condition_transitions
      : undefined,
    resolved_baselines: safeCharacterStateAxes(obj.resolved_baselines),
  };
}

function safeCharacterStateAxes(
  raw: unknown,
): CharacterStateAxes | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.connection !== "number" &&
    typeof r.valence !== "number" &&
    typeof r.arousal !== "number" &&
    typeof r.restraint !== "number"
  ) {
    return undefined;
  }
  return {
    connection: safeNumber(r.connection, 0),
    valence: safeNumber(r.valence, 0),
    arousal: safeNumber(r.arousal, 0),
    restraint: safeNumber(r.restraint, 0),
  };
}

function safePartialCharacterStateAxes(
  raw: unknown,
): Partial<CharacterStateAxes> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const result: Partial<CharacterStateAxes> = {};
  if (typeof r.connection === "number") result.connection = r.connection;
  if (typeof r.valence === "number") result.valence = r.valence;
  if (typeof r.arousal === "number") result.arousal = r.arousal;
  if (typeof r.restraint === "number") result.restraint = r.restraint;
  if (Object.keys(result).length === 0) return undefined;
  return result;
}

// ---------------------------------------------------------------------------
// TG1: Persist both axis state and message snapshot in one transaction
// ---------------------------------------------------------------------------

/**
 * Minimal transaction interface matching the Drizzle methods used by
 * `persistAxisSnapshotTx`. This avoids importing heavy ORM types for
 * testability.
 *
 * The return types are intentionally loose (Record<string, unknown>) to
 * accept both real Drizzle transactions and test fakes.
 */
export interface AxisPersistenceTx {
  select: () => {
    from: (table: unknown) => {
      where: (condition: unknown) => {
        limit: (n: number) => Promise<Array<Record<string, unknown>>>;
      };
    };
  };
  insert: (table: unknown) => {
    values: (data: Record<string, unknown>) => {
      onConflictDoUpdate: (config: {
        target: unknown;
        set: Record<string, unknown>;
      }) => Promise<void>;
    };
  };
  update: (table: unknown) => {
    set: (data: Record<string, unknown>) => {
      where: (condition: unknown) => {
        returning: (fields: Record<string, unknown>) => Promise<unknown[]>;
      };
    };
  };
}

/**
 * Inner transaction body for `persistAxisSnapshot()`, extracted for testability.
 *
 * Accepts a transaction handle directly so tests can pass a fake tx without
 * mocking the entire `db` module.
 */
export async function persistAxisSnapshotTx(
  tx: AxisPersistenceTx,
  sessionId: string,
  assistantMessageId: string,
  nextPersisted: PersistedAxisState,
  exportSnapshot: EmotionalAxisTurnExportSnapshot,
): Promise<void> {
  // 1. Read current session_state row within the transaction
  const rows = await tx
    .select()
    .from(sessionStateTable)
    .where(eq(sessionStateTable.sessionId, sessionId))
    .limit(1);
  const row = rows[0] ?? null;

  const existingDelta: Record<string, unknown> =
    row?.localRelationshipDelta
      ? (row.localRelationshipDelta as Record<string, unknown>)
      : {};

  const merged = mergeAxisStateIntoDelta(existingDelta, nextPersisted);

  // 2. Upsert session_state with merged delta
  await tx
    .insert(sessionStateTable)
    .values({
      sessionId,
      localRelationshipDelta: merged,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: sessionStateTable.sessionId,
      set: {
        localRelationshipDelta: merged,
        updatedAt: new Date(),
      },
    });

  // 3. Update chat_messages with the export snapshot
  const updated = await tx
    .update(chatMessages)
    .set({ emotionalAxis: exportSnapshot })
    .where(eq(chatMessages.id, assistantMessageId))
    .returning({ id: chatMessages.id });

    // 4. Verify that the assistant message row was updated.
    //    If no row matched, throw so the transaction rolls back both the
    //    session_state upsert and the message update.
    if (updated.length === 0) {
      throw new MissingAssistantMessageError(assistantMessageId, sessionId);
    }
}

/**
 * Persist the axis state update and the per-turn message snapshot atomically.
 * Updates `session_state.local_relationship_delta.axis_state` and
 * `chat_messages.emotional_axis` for the given `assistantMessageId`
 * inside a single DB transaction.
 */
export async function persistAxisSnapshot(
  sessionId: string,
  assistantMessageId: string,
  nextPersisted: PersistedAxisState,
  exportSnapshot: EmotionalAxisTurnExportSnapshot,
): Promise<void> {
  await db.transaction(async (tx) => {
    await persistAxisSnapshotTx(
      tx as unknown as AxisPersistenceTx,
      sessionId,
      assistantMessageId,
      nextPersisted,
      exportSnapshot,
    );
  });
}

function safeNumber(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return fallback;
}

const VALID_BANDS = new Set(["high", "mid", "low"]);

function safeBand(v: unknown): "high" | "mid" | "low" {
  if (typeof v === "string" && VALID_BANDS.has(v)) return v as "high" | "mid" | "low";
  return "mid";
}

function isValidBand(v: unknown): v is "high" | "mid" | "low" {
  return typeof v === "string" && VALID_BANDS.has(v);
}

// ---------------------------------------------------------------------------
// axisStatePersistence — Read/write helpers for the versioned axis_state
// sub-object inside session_state.local_relationship_delta (JSONB).
//
// Design D2: versioned, merge-preserving, bounded history (cap 6).
// ---------------------------------------------------------------------------

import { getSessionState, upsertSessionState } from "../sessionStateRepo";
import type { SessionState } from "../../db/schema/chat";
import type { PersistedAxisState, AxisName } from "./types";
import { HISTORY_CAP } from "./constants";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AXIS_STATE_KEY = "axis_state";
const CURRENT_VERSION = 1 as const;

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
// Internal helpers
// ---------------------------------------------------------------------------

function safeNumber(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return fallback;
}

const VALID_BANDS = new Set(["high", "mid", "low"]);

function safeBand(v: unknown): "high" | "mid" | "low" {
  if (typeof v === "string" && VALID_BANDS.has(v)) return v as "high" | "mid" | "low";
  return "mid";
}

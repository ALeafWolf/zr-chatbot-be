import { z } from "zod";

/** Structured session memory; `summary_json` source of truth in DB. */
export const SessionSummaryJsonSchema = z.object({
  currentSituation: z.string(),
  establishedFacts: z.array(
    z.object({
      fact: z.string(),
      sourceTurnIndex: z.number().int(),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
  relationshipState: z.object({
    emotionalTone: z.string(),
    trustLevel: z.string().optional(),
    unresolvedTension: z.array(z.string()).optional(),
    recentShift: z.string().optional(),
  }),
  userPreferences: z.array(
    z.object({
      preference: z.string(),
      scope: z.enum(["this_session", "possibly_durable"]),
      sourceTurnIndex: z.number().int(),
    }),
  ),
  openThreads: z.array(
    z.object({
      thread: z.string(),
      status: z.enum(["open", "paused", "resolved"]),
      sourceTurnIndex: z.number().int(),
    }),
  ),
  decisionsAndCommitments: z.array(
    z.object({
      item: z.string(),
      owner: z
        .enum(["user", "assistant", "character", "shared"])
        .optional(),
      sourceTurnIndex: z.number().int(),
    }),
  ),
  contradictionsOrCorrections: z.array(
    z.object({
      oldClaim: z.string(),
      correctedClaim: z.string(),
      sourceTurnIndex: z.number().int(),
    }),
  ),
});

export type SessionSummaryJson = z.infer<typeof SessionSummaryJsonSchema>;

/** Hard cap for `currentSituation` after merger (DB + prompt safety). */
export const SESSION_SUMMARY_MAX_SITUATION_CHARS = 80_000;

const LegacyProseSchema = z.object({
  prose: z.string(),
});

function asTrimmedString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  return String(v);
}

function asInt(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) {
    return parseInt(v.trim(), 10);
  }
  return fallback;
}

function coerceConfidence(v: unknown): "high" | "medium" | "low" {
  if (v === "high" || v === "medium" || v === "low") return v;
  return "medium";
}

function coerceScope(v: unknown): "this_session" | "possibly_durable" {
  if (v === "this_session" || v === "possibly_durable") return v;
  return "this_session";
}

function coerceThreadStatus(v: unknown): "open" | "paused" | "resolved" {
  if (v === "open" || v === "paused" || v === "resolved") return v;
  return "open";
}

const OWNER_SET = new Set(["user", "assistant", "character", "shared"]);

/**
 * Accept either `{ "summary_json": { ... } }` or a bare structured object at the root
 * (some models omit the wrapper).
 */
export function extractMergerEnvelopeBody(envelope: unknown): unknown | null {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return null;
  }
  const e = envelope as Record<string, unknown>;
  const inner = e.summary_json;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return inner;
  }
  if (
    "currentSituation" in e ||
    "establishedFacts" in e ||
    "relationshipState" in e ||
    "userPreferences" in e ||
    "openThreads" in e ||
    "decisionsAndCommitments" in e ||
    "contradictionsOrCorrections" in e
  ) {
    return e;
  }
  return null;
}

export function isNonEmptyMergerBody(body: unknown): boolean {
  return (
    !!body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.keys(body as object).length > 0
  );
}

function coerceEstablishedFacts(raw: unknown[]): SessionSummaryJson["establishedFacts"] {
  const out: SessionSummaryJson["establishedFacts"] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const fact = asTrimmedString(o.fact).trim();
    if (!fact) continue;
    out.push({
      fact: fact.slice(0, 2000),
      sourceTurnIndex: asInt(o.sourceTurnIndex, 0),
      confidence: coerceConfidence(o.confidence),
    });
  }
  return out;
}

function coerceUserPreferences(raw: unknown[]): SessionSummaryJson["userPreferences"] {
  const out: SessionSummaryJson["userPreferences"] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const preference = asTrimmedString(o.preference).trim();
    if (!preference) continue;
    out.push({
      preference: preference.slice(0, 2000),
      scope: coerceScope(o.scope),
      sourceTurnIndex: asInt(o.sourceTurnIndex, 0),
    });
  }
  return out;
}

function coerceOpenThreads(raw: unknown[]): SessionSummaryJson["openThreads"] {
  const out: SessionSummaryJson["openThreads"] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const thread = asTrimmedString(o.thread).trim();
    if (!thread) continue;
    out.push({
      thread: thread.slice(0, 2000),
      status: coerceThreadStatus(o.status),
      sourceTurnIndex: asInt(o.sourceTurnIndex, 0),
    });
  }
  return out;
}

function coerceDecisions(raw: unknown[]): SessionSummaryJson["decisionsAndCommitments"] {
  const out: SessionSummaryJson["decisionsAndCommitments"] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const line = asTrimmedString(o.item).trim();
    if (!line) continue;
    const ownerRaw = o.owner;
    const entry: SessionSummaryJson["decisionsAndCommitments"][number] = {
      item: line.slice(0, 2000),
      sourceTurnIndex: asInt(o.sourceTurnIndex, 0),
    };
    if (typeof ownerRaw === "string" && OWNER_SET.has(ownerRaw)) {
      entry.owner = ownerRaw as NonNullable<
        SessionSummaryJson["decisionsAndCommitments"][number]["owner"]
      >;
    }
    out.push(entry);
  }
  return out;
}

function coerceContradictions(raw: unknown[]): SessionSummaryJson["contradictionsOrCorrections"] {
  const out: SessionSummaryJson["contradictionsOrCorrections"] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const oldClaim = asTrimmedString(o.oldClaim).trim();
    const correctedClaim = asTrimmedString(o.correctedClaim).trim();
    if (!oldClaim || !correctedClaim) continue;
    out.push({
      oldClaim: oldClaim.slice(0, 2000),
      correctedClaim: correctedClaim.slice(0, 2000),
      sourceTurnIndex: asInt(o.sourceTurnIndex, 0),
    });
  }
  return out;
}

function mergeRelationshipState(
  existing: SessionSummaryJson["relationshipState"],
  raw: Record<string, unknown>,
): SessionSummaryJson["relationshipState"] {
  const emotionalTone = (
    "emotionalTone" in raw ? asTrimmedString(raw.emotionalTone) : existing.emotionalTone
  ).slice(0, 2000);

  let trustLevel: string | undefined;
  if ("trustLevel" in raw) {
    if (raw.trustLevel === undefined || raw.trustLevel === null) {
      trustLevel = undefined;
    } else {
      const s = asTrimmedString(raw.trustLevel).trim();
      trustLevel = s === "" ? undefined : s.slice(0, 500);
    }
  } else {
    trustLevel = existing.trustLevel;
  }

  let unresolvedTension: string[] | undefined;
  if ("unresolvedTension" in raw) {
    if (!Array.isArray(raw.unresolvedTension)) {
      unresolvedTension = existing.unresolvedTension;
    } else if (raw.unresolvedTension.length === 0) {
      unresolvedTension = undefined;
    } else {
      unresolvedTension = raw.unresolvedTension
        .map((x) => asTrimmedString(x).trim())
        .filter(Boolean)
        .slice(0, 32);
    }
  } else {
    unresolvedTension = existing.unresolvedTension;
  }

  let recentShift: string | undefined;
  if ("recentShift" in raw) {
    if (raw.recentShift === undefined || raw.recentShift === null) {
      recentShift = undefined;
    } else {
      const s = asTrimmedString(raw.recentShift).trim();
      recentShift = s === "" ? undefined : s.slice(0, 2000);
    }
  } else {
    recentShift = existing.recentShift;
  }

  return {
    emotionalTone,
    ...(trustLevel !== undefined ? { trustLevel } : {}),
    ...(unresolvedTension && unresolvedTension.length > 0 ? { unresolvedTension } : {}),
    ...(recentShift !== undefined ? { recentShift } : {}),
  };
}

/**
 * Merge model output into the previous summary. Only keys **present** on `body` replace
 * the existing value (so omitted keys keep prior data — avoids Zod-hard-fail wiping state).
 */
export function mergeMergerPayloadIntoExisting(
  existing: SessionSummaryJson,
  body: unknown,
): SessionSummaryJson {
  if (!isNonEmptyMergerBody(body)) {
    return existing;
  }
  const b = body as Record<string, unknown>;
  const out: SessionSummaryJson = { ...existing };

  if ("currentSituation" in b) {
    out.currentSituation = asTrimmedString(b.currentSituation).slice(
      0,
      SESSION_SUMMARY_MAX_SITUATION_CHARS,
    );
  }
  if ("establishedFacts" in b && Array.isArray(b.establishedFacts)) {
    out.establishedFacts = coerceEstablishedFacts(b.establishedFacts);
  }
  if ("userPreferences" in b && Array.isArray(b.userPreferences)) {
    out.userPreferences = coerceUserPreferences(b.userPreferences);
  }
  if ("openThreads" in b && Array.isArray(b.openThreads)) {
    out.openThreads = coerceOpenThreads(b.openThreads);
  }
  if ("decisionsAndCommitments" in b && Array.isArray(b.decisionsAndCommitments)) {
    out.decisionsAndCommitments = coerceDecisions(b.decisionsAndCommitments);
  }
  if ("contradictionsOrCorrections" in b && Array.isArray(b.contradictionsOrCorrections)) {
    out.contradictionsOrCorrections = coerceContradictions(b.contradictionsOrCorrections);
  }
  if (
    "relationshipState" in b &&
    b.relationshipState &&
    typeof b.relationshipState === "object" &&
    !Array.isArray(b.relationshipState)
  ) {
    out.relationshipState = mergeRelationshipState(
      existing.relationshipState,
      b.relationshipState as Record<string, unknown>,
    );
  }

  const parsed = SessionSummaryJsonSchema.safeParse(out);
  return parsed.success ? parsed.data : existing;
}

/** Phase 1 legacy shape stored in summary_json. */
export function isLegacyProseSummary(raw: unknown): raw is { prose: string } {
  return LegacyProseSchema.safeParse(raw).success;
}

export function emptySessionSummary(): SessionSummaryJson {
  return {
    currentSituation: "",
    establishedFacts: [],
    relationshipState: {
      emotionalTone: "",
    },
    userPreferences: [],
    openThreads: [],
    decisionsAndCommitments: [],
    contradictionsOrCorrections: [],
  };
}

/**
 * Normalize DB jsonb into SessionSummaryJson.
 * Legacy `{ prose }` is folded into currentSituation so merger can upgrade to structured form.
 */
export function normalizeSessionSummaryJson(raw: unknown): SessionSummaryJson {
  const structured = SessionSummaryJsonSchema.safeParse(raw);
  if (structured.success) return structured.data;

  if (isLegacyProseSummary(raw)) {
    return {
      ...emptySessionSummary(),
      currentSituation: raw.prose.slice(0, SESSION_SUMMARY_MAX_SITUATION_CHARS),
    };
  }

  return emptySessionSummary();
}

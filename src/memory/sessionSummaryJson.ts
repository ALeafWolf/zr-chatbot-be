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

const LegacyProseSchema = z.object({
  prose: z.string(),
});

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
      currentSituation: raw.prose.slice(0, 6000),
    };
  }

  return emptySessionSummary();
}

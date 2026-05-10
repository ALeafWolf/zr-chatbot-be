/**
 * Maps a continuity scope to the ordered list of relationship arc_keys it includes.
 *
 * Main-world scope inheritance table (§5):
 *   main_pre_relationship → [main_weiming]
 *   main_situationship    → [main_weiming, main_yimu]
 *   main_relationship     → [main_weiming, main_yimu, main_tianmi]
 *   main_engaged          → [main_weiming, main_yimu, main_tianmi, main_zhiai]
 *   main_married          → [main_weiming, main_yimu, main_tianmi, main_zhiai, main_xiangshou]   ← Phase 1 default (character yaml)
 *
 * AU scopes are isolated to their own au_world_key and return an empty arc list
 * (the caller uses the au_world_id filter instead).
 */

export interface ScopeResolution {
  continuityFamily: "main_world" | "au";
  /** Ordered arc_keys from oldest to most recent; empty for AU (use auWorldKey). */
  arcKeys: string[];
  auWorldKey?: string;
}

/** Phase 1 main-world scopes exposed by `/api/scopes`, in UX order oldest → newest arc stack. */
export const AVAILABLE_SCOPES = [
  "main_pre_relationship",
  "main_situationship",
  "main_relationship",
  "main_engaged",
  "main_married",
] as const;

export type MainWorldScope = (typeof AVAILABLE_SCOPES)[number];

const MAIN_WORLD_SCOPE_ARCS: Record<MainWorldScope, string[]> = {
  main_pre_relationship: ["main_weiming"],
  main_situationship: ["main_weiming", "main_yimu"],
  main_relationship: ["main_weiming", "main_yimu", "main_tianmi"],
  main_engaged: ["main_weiming", "main_yimu", "main_tianmi", "main_zhiai"],
  main_married: [
    "main_weiming",
    "main_yimu",
    "main_tianmi",
    "main_zhiai",
    "main_xiangshou",
  ],
};

export function resolveContinuityScope(
  continuityScope: string,
  continuityFamily: "main_world" | "au",
  auWorldKey?: string,
): ScopeResolution {
  if (continuityFamily === "au") {
    if (!auWorldKey) {
      throw new Error(
        `resolveContinuityScope: auWorldKey is required for AU scope "${continuityScope}"`,
      );
    }
    return { continuityFamily: "au", arcKeys: [], auWorldKey };
  }

  const arcKeys = MAIN_WORLD_SCOPE_ARCS[continuityScope as MainWorldScope];
  if (!arcKeys) {
    throw new Error(
      `resolveContinuityScope: unknown main-world scope "${continuityScope}". ` +
        `Known scopes: ${AVAILABLE_SCOPES.join(", ")}`,
    );
  }

  return { continuityFamily: "main_world", arcKeys };
}

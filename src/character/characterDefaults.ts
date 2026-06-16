import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import { env } from "../config/env";
import { getCharacterProfile } from "./characterProfiles";
import type { AxesConfig, ScopeBaselineOverrides, EmotionalCoupling } from "../state/emotionalEngine/types";
import { validateCouplings } from "../state/emotionalEngine/validateCouplings";

// ---------------------------------------------------------------------------
// Version comparison helper
// ---------------------------------------------------------------------------

/**
 * Compare two dot-separated numeric versions segment-by-segment.
 * Returns a negative/zero/positive number like a standard comparator,
 * or `null` when either version is missing or has a non-numeric segment.
 * Missing trailing segments are treated as 0, so "2.1" === "2.1.0".
 *
 * Examples:
 *   compareDottedVersions("2.10", "2.9")  →  1   (DB 2.10 newer)
 *   compareDottedVersions("2.9", "2.10")  → -1
 *   compareDottedVersions("2.1", "2.1.0") →  0   (equal)
 *   compareDottedVersions(null, "2.1")    → null (missing)
 *   compareDottedVersions("abc", "2.1")   → null (non-numeric)
 */
export function compareDottedVersions(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  if (!a || !b) return null;
  const pa = a.split(".");
  const pb = b.split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const sa = pa[i] ?? "0";
    const sb = pb[i] ?? "0";
    const na = Number(sa);
    const nb = Number(sb);
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return null;
    if (na !== nb) return na - nb;
  }
  return 0;
}

export interface CharacterDefaults {
  character_id: string;
  name: string;
  archetype: string;
  identity: string;
  speech_style: {
    language: string;
    formality: string;
    emotionality: string;
    preferred_patterns: string[];
    avoid: string[];
  };
  core_traits?: string[];
  /** General output craft (rhythm, imagery, narrator vs dialogue); prompts as [叙事文笔]. */
  narrative_prose_guidelines?: string;
  /** Character-specific voice, dialogue habits, micro-actions; prompts as [角色表达]. */
  in_character_expression?: string;
  /** Character does not restructure replies to match user-requested list/framework formats. */
  format_resistance?: string;
  /** Character corrects false canon premises calmly; mirrors SYSTEM block canon-correction paragraph. */
  canon_correction?: string;
  /** Long-form affective grounding; surfaced in prompts as [情感内核]. */
  emotional_core?: string;
  /** Pre-DB internal-logic core: stable psychological causality behind character behavior.
   *  All fields optional; block renders only when at least one is non-empty. */
  internal_logic?: {
    /** Formative background that set baseline assumptions about the world. */
    growth_environment?: string;
    /** Deep, usually unquestioned assumption about how things work. */
    core_belief?: string;
    /** What the character most wants. */
    core_motivation?: string;
    /** What the character most fears losing or causing. */
    core_fear?: string;
    /** Habitual behaviors that protect against core_fear, written with their source (改版二). */
    defense_mechanism?: string;
    /** Explicit transition rule between emotional states; targets Type 5 missing-transition failures. */
    transition_rule?: string;
    /** Gates internal-logic expression depth by relationship stage. */
    relationship_scope_gate?: string;
    /** Prohibits direct self-analysis dialogue; enforces show-don't-tell. */
    expression_constraint?: string;
  };
  /** Emotional-engine axis configuration (baselines, drift rates, ranges per axis).
   *  Absent block ⇒ engine disabled for this character (default-off behaviour). */
  emotional_axes?: AxesConfig;
  /** Per-scope baseline overrides (design D8). Keyed by continuityScope value.
   *  Missing axis/scope ⇒ fall back to default baseline from `emotional_axes`. */
  emotional_axes_baseline_by_scope?: ScopeBaselineOverrides;
  /** Emotional coupling definitions. Optional; engine treats absent as no couplings. */
  emotional_coupling?: EmotionalCoupling[];
  private_habits_and_texture?: string[];
  /** Layered relational behavior prose; subsets chosen by overlay `relationship_status`. */
  relationship_expression?: {
    general?: string;
    intimate?: string;
    married?: string;
  };
  values?: string[];
  hard_rules: string[];
  interaction_defaults: {
    default_continuity_scope: string;
    default_emotional_baseline: string;
    default_relationship_baseline: string;
    response_length: string;
    allows_personal_topics: string;
  };
  safe_deflection: string;
  version: string;
}

export interface PersonaOverlayDefaults {
  overlay_id: string;
  character_id: string;
  continuity_scope: string;
  relationship_status: string;
  openness: string;
  domesticity: string;
  baseline_warmth: string;
  baseline_nsfw_openness: string;
  max_nsfw_level: string;
  escalation_rule: string;
  out_of_scope_chapter_behavior: string;
  overlay_identity: string;
  tone_notes: Record<string, string>;
  writeback_policies: Record<string, string>;
}

// Process-lifetime cache — loaded once at startup
const characterCache = new Map<string, CharacterDefaults>();
const overlayCache = new Map<string, PersonaOverlayDefaults>();

const DEFAULTS_DIR = path.join(__dirname, "defaults");
const OVERLAYS_DIR = path.join(__dirname, "overlays");

export function loadCharacterDefaults(characterId: string): CharacterDefaults {
  if (characterCache.has(characterId)) {
    return characterCache.get(characterId)!;
  }
  // Lazy cache-miss path: returns pure YAML with no DB merge.
  // DB-internal_logic precedence requires the async warmCharacterCache() to
  // have run at startup. This path is a safe fallback, not a correctness bug.
  const filePath = path.join(DEFAULTS_DIR, `${characterId}.yaml`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Character defaults not found for: ${characterId}`);
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = yaml.load(raw) as CharacterDefaults;
  // TG5: validate and normalise coupling definitions at load time
  if (parsed.emotional_coupling) {
    parsed.emotional_coupling = validateCouplings(
      parsed.emotional_coupling,
      parsed.internal_logic ? new Set(Object.keys(parsed.internal_logic)) : undefined,
    );
  }
  characterCache.set(characterId, parsed);
  return parsed;
}

export function loadPersonaOverlay(overlayId: string): PersonaOverlayDefaults {
  if (overlayCache.has(overlayId)) {
    return overlayCache.get(overlayId)!;
  }
  const filePath = path.join(OVERLAYS_DIR, `${overlayId}.yaml`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Persona overlay not found: ${overlayId}`);
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = yaml.load(raw) as PersonaOverlayDefaults;
  overlayCache.set(overlayId, parsed);
  return parsed;
}

/**
 * Merge DB internal_logic over the YAML-loaded cache entry for one character
 * when all precedence conditions are met. Logs the winning source.
 *
 * Exported for unit testing — callers should use warmCharacterCache() instead.
 */
export async function mergeDbInternalLogic(characterId: string): Promise<void> {
  const cached = characterCache.get(characterId);
  if (!cached) return;

  try {
    const profile = await getCharacterProfile(characterId);

    if (!profile) {
      console.warn(
        `[warmCharacterCache] DB row missing for "${characterId}" — using YAML internal_logic`,
      );
      return;
    }

    if (!profile.internalLogic) {
      console.warn(
        `[warmCharacterCache] DB internal_logic is null for "${characterId}" — using YAML`,
      );
      return;
    }

    // Version precedence: DB version must parse and be at least the YAML version.
    // Uses compareDottedVersions instead of parseFloat so that multi-segment
    // versions like "2.10" are correctly ordered after "2.9".
    const cmp = compareDottedVersions(profile.version, cached.version);
    if (cmp === null || cmp < 0) {
      console.warn(
        `[warmCharacterCache] DB version "${profile.version}" is missing/older ` +
          `than YAML version "${cached.version}" for "${characterId}" — using YAML`,
      );
      return;
    }

    // Key-level PARTIAL OVERLAY, not full replacement:
    //  - DB field values win over YAML at the key level.
    //  - YAML keys absent from the DB row are preserved.
    //  - Removing a key from the DB row causes the YAML value to resurface.
    // This is intended: the DB layer customizes/overrides individual
    // internal_logic fields without having to restate the whole YAML block.
    cached.internal_logic = {
      ...(cached.internal_logic as Record<string, string>),
      ...(profile.internalLogic as Record<string, string>),
    };

    console.log(
      `[warmCharacterCache] { source: "db", characterId: "${characterId}", version: "${profile.version}" }`,
    );
  } catch (err) {
    console.error(
      `[warmCharacterCache] DB read failed for "${characterId}": ${(err as Error).message} — using YAML`,
    );
  }
}

/** Pre-warm all known character defaults and overlays at server startup.
 *  When CHARACTER_PROFILE_DB_ENABLED is ON, merges DB internal_logic over
 *  the YAML-loaded defaults per the precedence rules defined in design.md. */
export async function warmCharacterCache(): Promise<void> {
  const defaultFiles = fs.readdirSync(DEFAULTS_DIR).filter((f) =>
    f.endsWith(".yaml"),
  );
  for (const file of defaultFiles) {
    const characterId = file.replace(".yaml", "");
    loadCharacterDefaults(characterId);

    // DB merge: only when the env flag is ON
    if (env.CHARACTER_PROFILE_DB_ENABLED) {
      await mergeDbInternalLogic(characterId);
    } else {
      console.log(
        `[warmCharacterCache] { source: "yaml", characterId: "${characterId}", version: "${characterCache.get(characterId)?.version ?? "?"}" }`,
      );
    }
  }
  const overlayFiles = fs.readdirSync(OVERLAYS_DIR).filter((f) =>
    f.endsWith(".yaml"),
  );
  for (const file of overlayFiles) {
    const overlayId = file.replace(".yaml", "");
    loadPersonaOverlay(overlayId);
  }
}

import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import { env } from "../config/env";
import { getCharacterProfile } from "./characterProfiles";

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

    // Version precedence: DB version must parse and not be older than YAML version
    const dbVersion = parseFloat(profile.version ?? "");
    const yamlVersion = parseFloat(cached.version ?? "");

    if (Number.isNaN(dbVersion) || Number.isNaN(yamlVersion) || dbVersion < yamlVersion) {
      console.warn(
        `[warmCharacterCache] DB version "${profile.version}" is missing/older than YAML version "${cached.version}" for "${characterId}" — using YAML`,
      );
      return;
    }

    // All conditions met — overlay DB internal_logic onto the cached entry.
    // DB field values win over YAML values at the key level.
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

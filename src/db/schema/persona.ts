import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// character_profiles
// ---------------------------------------------------------------------------
export const characterProfiles = pgTable("character_profiles", {
  characterId: text("character_id").primaryKey(),
  name: text("name").notNull(),
  archetype: text("archetype"),
  speechStyle: jsonb("speech_style"),
  values: jsonb("values"),
  hardRules: jsonb("hard_rules"),
  interactionDefaults: jsonb("interaction_defaults"),
  version: text("version"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---------------------------------------------------------------------------
// persona_overlays
// ---------------------------------------------------------------------------
export const personaOverlays = pgTable("persona_overlays", {
  overlayId: text("overlay_id").primaryKey(),
  characterId: text("character_id").notNull(),
  continuityScope: text("continuity_scope").notNull(),
  relationshipStatus: text("relationship_status"),
  openness: text("openness"),
  domesticity: text("domesticity"),
  baselineWarmth: text("baseline_warmth"),
  baselineNsfwOpenness: text("baseline_nsfw_openness"),
  maxNsfwLevel: text("max_nsfw_level"),
  escalationRule: text("escalation_rule"),
  outOfScopeChapterBehavior: text("out_of_scope_chapter_behavior"),
  toneNotes: jsonb("tone_notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type CharacterProfile = typeof characterProfiles.$inferSelect;
export type PersonaOverlay = typeof personaOverlays.$inferSelect;

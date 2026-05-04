/**
 * Read-only mirrors of the canon tables owned by scene-ingestor/script-extractor.
 * The chatbot reads these tables for retrieval; it NEVER writes to them.
 * No Drizzle migration is generated for this file (drizzle.config.ts excludes it).
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const vectorCol = customType<{
  data: number[];
  config: { dimensions: number };
  driverData: string;
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    if (Array.isArray(value)) return value as unknown as number[];
    return (value as string)
      .slice(1, -1)
      .split(",")
      .map(Number);
  },
});

export const relationshipArcs = pgTable(
  "relationship_arcs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: text("character_id").notNull(),
    arcKey: text("arc_key").notNull(),
    arcTitle: text("arc_title").notNull(),
    continuityFamily: text("continuity_family").notNull(),
    arcTimelineOrder: integer("arc_timeline_order"),
    scopeMembership: jsonb("scope_membership"),
    metadata: jsonb("metadata"),
  },
  (t) => [
    uniqueIndex("relationship_arcs_char_arc_key").on(t.characterId, t.arcKey),
  ],
);

export const auWorlds = pgTable(
  "au_worlds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: text("character_id").notNull(),
    relationshipArcId: uuid("relationship_arc_id")
      .notNull()
      .references(() => relationshipArcs.id, { onDelete: "cascade" }),
    auWorldKey: text("au_world_key").notNull(),
    auWorldTitle: text("au_world_title"),
    worldOrder: integer("world_order"),
    personaOverlayId: text("persona_overlay_id"),
    scopeMembership: jsonb("scope_membership"),
    metadata: jsonb("metadata"),
  },
  (t) => [
    uniqueIndex("au_worlds_char_arc_world_key").on(
      t.characterId,
      t.relationshipArcId,
      t.auWorldKey,
    ),
  ],
);

export const storyChapters = pgTable(
  "story_chapters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: text("character_id").notNull(),
    relationshipArcId: uuid("relationship_arc_id")
      .notNull()
      .references(() => relationshipArcs.id, { onDelete: "cascade" }),
    auWorldId: uuid("au_world_id").references(() => auWorlds.id, {
      onDelete: "cascade",
    }),
    chapterKey: text("chapter_key").notNull(),
    chapterName: text("chapter_name").notNull(),
    chapterLabel: text("chapter_label"),
    chapterTimelineOrder: integer("chapter_timeline_order"),
    chapterType: text("chapter_type").notNull(),
    inheritanceOrder: integer("inheritance_order"),
    scopeMembership: jsonb("scope_membership"),
    summary: text("summary"),
    metadata: jsonb("metadata"),
    manuallyEdited: boolean("manually_edited").notNull().default(false),
    manuallyEditedAt: timestamp("manually_edited_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("story_chapters_main_world_key")
      .on(t.characterId, t.relationshipArcId, t.chapterKey)
      .where(sql`${t.auWorldId} IS NULL`),
    uniqueIndex("story_chapters_au_key")
      .on(t.characterId, t.relationshipArcId, t.auWorldId, t.chapterKey)
      .where(sql`${t.auWorldId} IS NOT NULL`),
  ],
);

export const storyEpisodes = pgTable(
  "story_episodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: text("character_id").notNull(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => storyChapters.id, { onDelete: "cascade" }),
    episodeLabel: text("episode_label").notNull(),
    episodeOrder: integer("episode_order").notNull(),
    episodeTitle: text("episode_title"),
    summary: text("summary"),
    metadata: jsonb("metadata"),
    manuallyEdited: boolean("manually_edited").notNull().default(false),
    manuallyEditedAt: timestamp("manually_edited_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("story_episodes_chapter_label").on(t.chapterId, t.episodeLabel),
    index("story_episodes_chapter_id_idx").on(t.chapterId),
  ],
);

export const storyScenes = pgTable(
  "story_scenes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: text("character_id").notNull(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => storyChapters.id, { onDelete: "cascade" }),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => storyEpisodes.id, { onDelete: "cascade" }),
    sceneTitle: text("scene_title"),
    sceneOrder: integer("scene_order").notNull(),
    timelineOrder: integer("timeline_order"),
    location: text("location"),
    timeHint: text("time_hint"),
    sceneSummary: text("scene_summary"),
    emotionTags: jsonb("emotion_tags"),
    metadata: jsonb("metadata"),
    manuallyEdited: boolean("manually_edited").notNull().default(false),
    manuallyEditedAt: timestamp("manually_edited_at", { withTimezone: true }),
  },
  (t) => [
    index("story_scenes_episode_id_idx").on(t.episodeId),
    index("story_scenes_chapter_id_idx").on(t.chapterId),
  ],
);

export const storyUnits = pgTable(
  "story_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: text("character_id").notNull(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => storyChapters.id, { onDelete: "cascade" }),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => storyEpisodes.id, { onDelete: "cascade" }),
    sceneId: uuid("scene_id")
      .notNull()
      .references(() => storyScenes.id, { onDelete: "cascade" }),
    contentType: text("content_type").notNull(),
    unitIndex: integer("unit_index").notNull(),
    speaker: text("speaker"),
    canonPriority: real("canon_priority"),
    emotionTags: jsonb("emotion_tags"),
    rawText: text("raw_text"),
    textContent: text("text_content").notNull(),
    embedding: vectorCol("embedding", { dimensions: 1536 }),
    metadata: jsonb("metadata"),
    manuallyEdited: boolean("manually_edited").notNull().default(false),
    manuallyEditedAt: timestamp("manually_edited_at", { withTimezone: true }),
  },
  (t) => [
    index("story_units_scene_id_idx").on(t.sceneId),
    index("story_units_episode_id_idx").on(t.episodeId),
    index("story_units_chapter_id_idx").on(t.chapterId),
  ],
);

export type RelationshipArc = typeof relationshipArcs.$inferSelect;
export type AuWorld = typeof auWorlds.$inferSelect;
export type StoryChapter = typeof storyChapters.$inferSelect;
export type StoryEpisode = typeof storyEpisodes.$inferSelect;
export type StoryScene = typeof storyScenes.$inferSelect;
export type StoryUnit = typeof storyUnits.$inferSelect;

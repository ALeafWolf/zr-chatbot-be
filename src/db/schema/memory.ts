import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  index,
  customType,
} from "drizzle-orm/pg-core";

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

// ---------------------------------------------------------------------------
// interactive_memory_events
// ---------------------------------------------------------------------------
export const interactiveMemoryEvents = pgTable(
  "interactive_memory_events",
  {
    id: text("id").primaryKey(),
    characterId: text("character_id").notNull(),
    playerId: text("player_id").notNull(),
    sessionId: text("session_id").notNull(),
    continuityScope: text("continuity_scope").notNull(),
    continuityFamily: text("continuity_family").notNull(),
    memoryNamespace: text("memory_namespace").notNull(),
    isInheritable: boolean("is_inheritable").notNull().default(false),
    memoryType: text("memory_type").notNull(), // promise | relationship_transition | preference | habit | banter
    summary: text("summary").notNull(),
    importanceScore: real("importance_score").notNull().default(0),
    emotionScore: real("emotion_score").notNull().default(0),
    recencyScore: real("recency_score").notNull().default(1),
    decayedImportanceScore: real("decayed_importance_score"),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    reuseCount: integer("reuse_count").notNull().default(0),
    canonicalToChat: boolean("canonical_to_chat").notNull().default(false),
    tags: jsonb("tags"),
    embedding: vectorCol("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("ime_namespace_idx").on(t.memoryNamespace),
    index("ime_character_player_idx").on(t.characterId, t.playerId),
  ],
);

// ---------------------------------------------------------------------------
// session_archive
// ---------------------------------------------------------------------------
export const sessionArchive = pgTable("session_archive", {
  sessionId: text("session_id").primaryKey(),
  summaryShort: text("summary_short"),
  summaryMedium: text("summary_medium"),
  archivedTranscriptRef: text("archived_transcript_ref"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---------------------------------------------------------------------------
// player_profile
// ---------------------------------------------------------------------------
export const playerProfile = pgTable("player_profile", {
  playerId: text("player_id").primaryKey(),
  knownName: text("known_name"),
  preferenceNotes: jsonb("preference_notes"),
  stableFacts: jsonb("stable_facts"),
  relationshipNotes: jsonb("relationship_notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type InteractiveMemoryEvent =
  typeof interactiveMemoryEvents.$inferSelect;
export type NewInteractiveMemoryEvent =
  typeof interactiveMemoryEvents.$inferInsert;
export type SessionArchive = typeof sessionArchive.$inferSelect;
export type PlayerProfile = typeof playerProfile.$inferSelect;

import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { chatSessions } from "./chat";
import { vectorCol } from "./vector";

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
// session_summaries — structured, incrementally merged session memory (Phases 1–2)
// ---------------------------------------------------------------------------
export const sessionSummaries = pgTable(
  "session_summaries",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .unique()
      .references(() => chatSessions.sessionId, { onDelete: "cascade" }),
    characterId: text("character_id").notNull(),
    playerId: text("player_id").notNull(),
    lastSummarizedTurnIndex: integer("last_summarized_turn_index")
      .notNull()
      .default(-1),
    summaryJson: jsonb("summary_json").notNull().$type<unknown>(),
    summaryText: text("summary_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("session_summaries_session_idx").on(t.sessionId)],
);

// ---------------------------------------------------------------------------
// session_memory_chunks — per-session embeddings for session-local recall (Phase 3)
// ---------------------------------------------------------------------------
export const sessionMemoryChunks = pgTable(
  "session_memory_chunks",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => chatSessions.sessionId, { onDelete: "cascade" }),
    characterId: text("character_id").notNull(),
    playerId: text("player_id").notNull(),
    turnStart: integer("turn_start").notNull(),
    turnEnd: integer("turn_end").notNull(),
    chunkText: text("chunk_text").notNull(),
    embedding: vectorCol("embedding", { dimensions: 1536 }).notNull(),
    chunkType: text("chunk_type").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("smc_session_turn_idx").on(t.sessionId, t.turnEnd),
  ],
);

// ---------------------------------------------------------------------------
// session_archive
// Deprecated: no runtime backend code currently reads or writes this table.
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
// Deprecated candidate: playerProfileRepo is unused and local row count is zero.
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
export type SessionSummary = typeof sessionSummaries.$inferSelect;
export type NewSessionSummary = typeof sessionSummaries.$inferInsert;
export type SessionMemoryChunk = typeof sessionMemoryChunks.$inferSelect;
export type NewSessionMemoryChunk = typeof sessionMemoryChunks.$inferInsert;

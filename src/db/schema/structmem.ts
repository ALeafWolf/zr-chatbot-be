import {
  pgTable,
  text,
  integer,
  real,
  timestamp,
  jsonb,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { chatSessions, chatMessages } from "./chat";
import { vectorCol } from "./vector";

// ---------------------------------------------------------------------------
// structmem_events
// ---------------------------------------------------------------------------
export const structmemEvents = pgTable(
  "structmem_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => chatSessions.sessionId, { onDelete: "cascade" }),
    characterId: text("character_id").notNull(),
    playerId: text("player_id").notNull(),
    memoryNamespace: text("memory_namespace").notNull(),
    continuityScope: text("continuity_scope"),
    continuityFamily: text("continuity_family"),
    turnIndex: integer("turn_index").notNull(),
    mode: text("mode"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("structmem_events_session_turn_idx").on(t.sessionId, t.turnIndex),
    index("structmem_events_namespace_idx").on(
      t.memoryNamespace,
      t.characterId,
      t.turnIndex,
    ),
  ],
);

// ---------------------------------------------------------------------------
// structmem_event_messages
// ---------------------------------------------------------------------------
export const structmemEventMessages = pgTable(
  "structmem_event_messages",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => structmemEvents.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.messageId] }),
    index("structmem_event_messages_message_idx").on(t.messageId),
  ],
);

// ---------------------------------------------------------------------------
// structmem_entries
// ---------------------------------------------------------------------------
export const structmemEntries = pgTable(
  "structmem_entries",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => structmemEvents.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => chatSessions.sessionId, { onDelete: "cascade" }),
    characterId: text("character_id").notNull(),
    playerId: text("player_id").notNull(),
    memoryNamespace: text("memory_namespace").notNull(),
    turnIndex: integer("turn_index").notNull(),
    /** Phase 1: scene_moment | decision | emotional_shift | open_thread only. */
    entryType: text("entry_type").notNull(),
    text: text("text").notNull(),
    embedding: vectorCol("embedding", { dimensions: 1536 }),
    importanceScore: real("importance_score"),
    confidenceScore: real("confidence_score"),
    firstConsolidatedAt: timestamp("first_consolidated_at", {
      withTimezone: true,
    }),
    consolidationCount: integer("consolidation_count").notNull().default(0),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("structmem_entries_session_turn_idx").on(t.sessionId, t.turnIndex),
    index("structmem_entries_namespace_idx").on(
      t.memoryNamespace,
      t.characterId,
      t.turnIndex,
    ),
  ],
);

// ---------------------------------------------------------------------------
// structmem_consolidations
// ---------------------------------------------------------------------------
export const structmemConsolidations = pgTable(
  "structmem_consolidations",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").references(() => chatSessions.sessionId, {
      onDelete: "set null",
    }),
    characterId: text("character_id").notNull(),
    playerId: text("player_id").notNull(),
    memoryNamespace: text("memory_namespace").notNull(),
    scope: text("scope").notNull(),
    summaryText: text("summary_text").notNull(),
    summaryJson: jsonb("summary_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    embedding: vectorCol("embedding", { dimensions: 1536 }),
    turnStart: integer("turn_start"),
    turnEnd: integer("turn_end"),
    confidenceScore: real("confidence_score"),
    promotionStatus: text("promotion_status").notNull().default("none"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("structmem_consolidations_session_idx").on(
      t.sessionId,
      t.createdAt,
    ),
    index("structmem_consolidations_scope_idx").on(
      t.memoryNamespace,
      t.characterId,
      t.scope,
      t.createdAt,
    ),
  ],
);

// ---------------------------------------------------------------------------
// structmem_consolidation_sources
// ---------------------------------------------------------------------------
export const structmemConsolidationSources = pgTable(
  "structmem_consolidation_sources",
  {
    consolidationId: text("consolidation_id")
      .notNull()
      .references(() => structmemConsolidations.id, { onDelete: "cascade" }),
    entryId: text("entry_id")
      .notNull()
      .references(() => structmemEntries.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => structmemEvents.id, { onDelete: "cascade" }),
    sourceRole: text("source_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.consolidationId, t.entryId] }),
    index("structmem_sources_event_idx").on(t.eventId),
    index("structmem_sources_entry_idx").on(t.entryId),
  ],
);

// ---------------------------------------------------------------------------
// structmem_consolidation_jobs
// ---------------------------------------------------------------------------
export const structmemConsolidationJobs = pgTable(
  "structmem_consolidation_jobs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => chatSessions.sessionId, { onDelete: "cascade" }),
    characterId: text("character_id").notNull(),
    playerId: text("player_id").notNull(),
    memoryNamespace: text("memory_namespace").notNull(),
    status: text("status").notNull().default("pending"),
    turnStart: integer("turn_start"),
    turnEnd: integer("turn_end"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("structmem_jobs_status_idx").on(t.status, t.createdAt),
    index("structmem_jobs_session_idx").on(t.sessionId, t.createdAt),
  ],
);

export type StructMemEvent = typeof structmemEvents.$inferSelect;
export type NewStructMemEvent = typeof structmemEvents.$inferInsert;
export type StructMemEventMessage = typeof structmemEventMessages.$inferSelect;
export type NewStructMemEventMessage =
  typeof structmemEventMessages.$inferInsert;
export type StructMemEntry = typeof structmemEntries.$inferSelect;
export type NewStructMemEntry = typeof structmemEntries.$inferInsert;
export type StructMemConsolidation =
  typeof structmemConsolidations.$inferSelect;
export type NewStructMemConsolidation =
  typeof structmemConsolidations.$inferInsert;
export type StructMemConsolidationSource =
  typeof structmemConsolidationSources.$inferSelect;
export type NewStructMemConsolidationSource =
  typeof structmemConsolidationSources.$inferInsert;
export type StructMemConsolidationJob =
  typeof structmemConsolidationJobs.$inferSelect;
export type NewStructMemConsolidationJob =
  typeof structmemConsolidationJobs.$inferInsert;

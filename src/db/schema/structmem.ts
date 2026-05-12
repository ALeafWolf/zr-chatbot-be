import {
  pgTable,
  text,
  integer,
  real,
  timestamp,
  jsonb,
  index,
  primaryKey,
  customType,
} from "drizzle-orm/pg-core";
import { chatSessions, chatMessages } from "./chat";

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

export type StructMemEvent = typeof structmemEvents.$inferSelect;
export type NewStructMemEvent = typeof structmemEvents.$inferInsert;
export type StructMemEventMessage = typeof structmemEventMessages.$inferSelect;
export type NewStructMemEventMessage =
  typeof structmemEventMessages.$inferInsert;
export type StructMemEntry = typeof structmemEntries.$inferSelect;
export type NewStructMemEntry = typeof structmemEntries.$inferInsert;

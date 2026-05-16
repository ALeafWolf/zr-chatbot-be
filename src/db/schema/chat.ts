import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  boolean,
  doublePrecision,
} from "drizzle-orm/pg-core";
import type { TurnRoute } from "../../orchestration/turnRoutes";

// ---------------------------------------------------------------------------
// chat_sessions
// ---------------------------------------------------------------------------
export const chatSessions = pgTable(
  "chat_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    characterId: text("character_id").notNull(),
    playerId: text("player_id").notNull(),
    mode: text("mode").notNull(), // canonical_live | pinned_scenario | sandbox
    continuityScope: text("continuity_scope").notNull(),
    continuityFamily: text("continuity_family").notNull().default("main_world"),
    personaOverlayId: text("persona_overlay_id"),
    memoryNamespace: text("memory_namespace").notNull(),
    pinnedTime: text("pinned_time"),
    pinnedLocation: text("pinned_location"),
    writebackPolicy: text("writeback_policy").notNull(), // full_writeback | optional_writeback | no_writeback
    sessionSummary: text("session_summary"),
    displayTitle: text("display_title"),
    /** Session-level generation "thinking" (mapped to provider-specific API fields). */
    thinking: boolean("thinking").notNull().default(true),
    /** Session temperature for validator rewrite path (`generateCharacterReplyStream`). */
    temperature: doublePrecision("temperature").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("chat_sessions_player_char_idx").on(t.playerId, t.characterId),
  ],
);

// ---------------------------------------------------------------------------
// chat_messages
// ---------------------------------------------------------------------------
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => chatSessions.sessionId, { onDelete: "cascade" }),
    turnIndex: integer("turn_index").notNull(),
    role: text("role").notNull(), // user | assistant
    route: text("route").$type<TurnRoute>().notNull().default("roleplay_turn"),
    content: text("content").notNull(),
    /** Character-voiced thought chain (streamed + persisted on assistant rows). */
    thoughts: jsonb("thoughts").$type<unknown>(),
    validatorResult: jsonb("validator_result"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("chat_messages_session_turn_idx").on(t.sessionId, t.turnIndex),
    index("chat_messages_session_route_turn_idx").on(
      t.sessionId,
      t.route,
      t.turnIndex,
    ),
  ],
);

// ---------------------------------------------------------------------------
// session_state
// ---------------------------------------------------------------------------
export const sessionState = pgTable("session_state", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => chatSessions.sessionId, { onDelete: "cascade" }),
  currentSceneContext: jsonb("current_scene_context"),
  localRelationshipDelta: jsonb("local_relationship_delta"),
  temporaryAssumptions: jsonb("temporary_assumptions"),
  derivedState: jsonb("derived_state"),
  lastTurnIndex: integer("last_turn_index").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type ChatSession = typeof chatSessions.$inferSelect;
export type NewChatSession = typeof chatSessions.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
export type SessionState = typeof sessionState.$inferSelect;
export type NewSessionState = typeof sessionState.$inferInsert;

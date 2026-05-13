import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { chatSessions, chatMessages } from "./chat";

export const postTurnJobs = pgTable(
  "post_turn_jobs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => chatSessions.sessionId, { onDelete: "cascade" }),
    userMessageId: text("user_message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    assistantMessageId: text("assistant_message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: timestamp("run_after", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    stepStatus: jsonb("step_status")
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("post_turn_jobs_assistant_message_uidx").on(
      t.assistantMessageId,
    ),
    index("post_turn_jobs_status_run_after_idx").on(t.status, t.runAfter),
    index("post_turn_jobs_session_idx").on(t.sessionId),
  ],
);

export type PostTurnJobRow = typeof postTurnJobs.$inferSelect;
export type NewPostTurnJobRow = typeof postTurnJobs.$inferInsert;

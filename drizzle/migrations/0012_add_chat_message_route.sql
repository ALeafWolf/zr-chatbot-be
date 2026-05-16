ALTER TABLE "chat_messages"
  ADD COLUMN IF NOT EXISTS "route" text NOT NULL DEFAULT 'roleplay_turn';

UPDATE "chat_messages"
SET "route" = 'roleplay_turn'
WHERE "route" IS NULL;

CREATE INDEX IF NOT EXISTS "chat_messages_session_route_turn_idx"
  ON "chat_messages" ("session_id", "route", "turn_index");

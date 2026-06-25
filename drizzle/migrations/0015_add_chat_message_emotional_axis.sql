-- TG1: Add emotional_axis JSONB column to chat_messages for per-turn
-- emotional-axis snapshots. Nullable; existing messages remain valid.
--
-- See agent-workspace/openspec/changes/2026-06-25-export-emotional-axis-history/

ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "emotional_axis" jsonb;

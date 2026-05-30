-- M-A: Add internal_logic column to character_profiles for DB-backed internal-logic
-- persistence. Nullable JSONB; YAML fallback when NULL.
--
-- See agent-workspace/openspec/changes/persist-internal-logic-in-db/

ALTER TABLE "character_profiles" ADD COLUMN IF NOT EXISTS "internal_logic" jsonb;

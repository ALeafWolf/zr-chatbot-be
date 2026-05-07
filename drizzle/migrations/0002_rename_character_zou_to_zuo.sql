-- Align stored character_id with defaults filename `zuo_ran.yaml` (was seeded as zou_ran).
-- Safe to run even if rows were never inserted (no-op).

UPDATE persona_overlays
SET character_id = 'zuo_ran'
WHERE character_id = 'zou_ran';

UPDATE chat_sessions
SET character_id = 'zuo_ran'
WHERE character_id = 'zou_ran';

UPDATE interactive_memory_events
SET character_id = 'zuo_ran'
WHERE character_id = 'zou_ran';

UPDATE character_profiles
SET character_id = 'zuo_ran'
WHERE character_id = 'zou_ran';

-- StructMem Phase 1: event anchors, message links, and searchable entries.

-- ---------------------------------------------------------------------------
-- structmem_events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS structmem_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  memory_namespace TEXT NOT NULL,
  continuity_scope TEXT,
  continuity_family TEXT,
  turn_index INTEGER NOT NULL,
  mode TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS structmem_events_session_turn_idx
  ON structmem_events (session_id, turn_index);

CREATE INDEX IF NOT EXISTS structmem_events_namespace_idx
  ON structmem_events (memory_namespace, character_id, turn_index);

-- ---------------------------------------------------------------------------
-- structmem_event_messages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS structmem_event_messages (
  event_id TEXT NOT NULL REFERENCES structmem_events(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, message_id)
);

CREATE INDEX IF NOT EXISTS structmem_event_messages_message_idx
  ON structmem_event_messages (message_id);

-- ---------------------------------------------------------------------------
-- structmem_entries
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS structmem_entries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES structmem_events(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  memory_namespace TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  entry_type TEXT NOT NULL CHECK (
    entry_type IN (
      'scene_moment',
      'decision',
      'emotional_shift',
      'open_thread',
      'factual',
      'relational'
    )
  ),
  text TEXT NOT NULL,
  embedding VECTOR(1536),
  importance_score REAL,
  confidence_score REAL,
  first_consolidated_at TIMESTAMPTZ,
  consolidation_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS structmem_entries_session_turn_idx
  ON structmem_entries (session_id, turn_index);

CREATE INDEX IF NOT EXISTS structmem_entries_namespace_idx
  ON structmem_entries (memory_namespace, character_id, turn_index);

CREATE INDEX IF NOT EXISTS structmem_entries_unconsolidated_idx
  ON structmem_entries (session_id, turn_index)
  WHERE first_consolidated_at IS NULL;

CREATE INDEX IF NOT EXISTS structmem_entries_namespace_unconsolidated_idx
  ON structmem_entries (memory_namespace, character_id, turn_index)
  WHERE first_consolidated_at IS NULL;

CREATE INDEX IF NOT EXISTS structmem_entries_embedding_hnsw_idx
  ON structmem_entries
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

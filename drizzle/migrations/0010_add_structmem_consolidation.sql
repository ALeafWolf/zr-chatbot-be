-- StructMem Phase 3: current-session consolidation jobs and synthesized memory.

CREATE TABLE IF NOT EXISTS structmem_consolidations (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES chat_sessions(session_id) ON DELETE SET NULL,
  character_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  memory_namespace TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('current_session', 'cross_session')),
  summary_text TEXT NOT NULL,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding VECTOR(1536),
  turn_start INTEGER,
  turn_end INTEGER,
  confidence_score REAL,
  promotion_status TEXT NOT NULL DEFAULT 'none' CHECK (
    promotion_status IN ('none', 'candidate', 'promoted', 'rejected')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS structmem_consolidations_session_idx
  ON structmem_consolidations (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS structmem_consolidations_scope_idx
  ON structmem_consolidations (
    memory_namespace,
    character_id,
    scope,
    created_at DESC
  );

CREATE INDEX IF NOT EXISTS structmem_consolidations_embedding_hnsw_idx
  ON structmem_consolidations
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE TABLE IF NOT EXISTS structmem_consolidation_sources (
  consolidation_id TEXT NOT NULL REFERENCES structmem_consolidations(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES structmem_entries(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES structmem_events(id) ON DELETE CASCADE,
  source_role TEXT NOT NULL CHECK (source_role IN ('buffer', 'semantic_seed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (consolidation_id, entry_id)
);

CREATE INDEX IF NOT EXISTS structmem_sources_event_idx
  ON structmem_consolidation_sources (event_id);

CREATE INDEX IF NOT EXISTS structmem_sources_entry_idx
  ON structmem_consolidation_sources (entry_id);

CREATE TABLE IF NOT EXISTS structmem_consolidation_jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  memory_namespace TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'dead_letter', 'skipped')
  ),
  turn_start INTEGER,
  turn_end INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_attempted_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS structmem_jobs_status_idx
  ON structmem_consolidation_jobs (status, created_at);

CREATE INDEX IF NOT EXISTS structmem_jobs_session_idx
  ON structmem_consolidation_jobs (session_id, created_at);

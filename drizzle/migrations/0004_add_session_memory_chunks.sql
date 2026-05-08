-- Session-local RAG chunks (Phase 3) — embeddings scoped per session_id only.

CREATE TABLE IF NOT EXISTS session_memory_chunks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  turn_start INTEGER NOT NULL,
  turn_end INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding VECTOR(1536) NOT NULL,
  chunk_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS smc_session_turn_idx ON session_memory_chunks(session_id, turn_end);

CREATE INDEX IF NOT EXISTS smc_embedding_hnsw_idx
  ON session_memory_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

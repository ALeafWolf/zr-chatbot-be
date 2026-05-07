CREATE TABLE IF NOT EXISTS session_summaries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  last_summarized_turn_index INTEGER NOT NULL DEFAULT -1,
  summary_json JSONB NOT NULL,
  summary_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS session_summaries_session_idx ON session_summaries (session_id);

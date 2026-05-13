-- Durable post-turn jobs for retryable memory writes and summary compaction.

CREATE TABLE IF NOT EXISTS post_turn_jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
  user_message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  assistant_message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'running', 'retry', 'completed', 'failed')
  ),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  step_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT post_turn_jobs_assistant_message_unique UNIQUE (assistant_message_id)
);

CREATE INDEX IF NOT EXISTS post_turn_jobs_status_run_after_idx
  ON post_turn_jobs (status, run_after);

CREATE INDEX IF NOT EXISTS post_turn_jobs_session_idx
  ON post_turn_jobs (session_id);

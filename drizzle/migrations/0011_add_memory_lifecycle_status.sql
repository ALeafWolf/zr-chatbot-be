ALTER TABLE interactive_memory_events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS superseded_by_id text REFERENCES interactive_memory_events(id);

CREATE INDEX IF NOT EXISTS ime_status_idx
  ON interactive_memory_events(status);

ALTER TABLE structmem_entries
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS superseded_by_entry_id text REFERENCES structmem_entries(id);

CREATE INDEX IF NOT EXISTS structmem_entries_status_idx
  ON structmem_entries(status);

CREATE TABLE IF NOT EXISTS compaction_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  summary_message_id TEXT NOT NULL REFERENCES messages(id),
  start_sequence INTEGER NOT NULL,
  end_sequence INTEGER NOT NULL,
  original_token_estimate INTEGER NOT NULL,
  summary_token_estimate INTEGER NOT NULL,
  compacted_at INTEGER NOT NULL,
  model_used TEXT NOT NULL,
  CONSTRAINT uq_session_range UNIQUE (session_id, start_sequence, end_sequence),
  CONSTRAINT chk_range_valid CHECK (end_sequence > start_sequence)
);

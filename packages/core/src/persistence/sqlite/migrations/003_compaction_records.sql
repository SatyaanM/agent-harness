CREATE TABLE IF NOT EXISTS compaction_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  summary_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  start_sequence INTEGER NOT NULL,
  end_sequence INTEGER NOT NULL,
  original_token_estimate INTEGER NOT NULL,
  summary_token_estimate INTEGER NOT NULL,
  compacted_at INTEGER NOT NULL,
  model_used TEXT NOT NULL,
  CONSTRAINT chk_sequence_range CHECK (end_sequence >= start_sequence)
);

CREATE INDEX IF NOT EXISTS idx_compaction_records_session_seq ON compaction_records(session_id, start_sequence ASC);
CREATE INDEX IF NOT EXISTS idx_compaction_records_summary ON compaction_records(summary_message_id);

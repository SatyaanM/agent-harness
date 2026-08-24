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
  CONSTRAINT uq_compaction_session_range UNIQUE (session_id, start_sequence, end_sequence),
  CONSTRAINT uq_compaction_summary UNIQUE (summary_message_id),
  CONSTRAINT chk_compaction_range_valid CHECK (end_sequence > start_sequence),
  CONSTRAINT chk_compaction_original_tokens CHECK (original_token_estimate >= 0),
  CONSTRAINT chk_compaction_summary_tokens CHECK (summary_token_estimate >= 0),
  CONSTRAINT chk_compaction_model_nonempty CHECK (length(model_used) > 0)
);

CREATE INDEX IF NOT EXISTS idx_compaction_records_session_seq ON compaction_records(session_id, start_sequence ASC);

CREATE TRIGGER IF NOT EXISTS trg_compaction_records_validate
BEFORE INSERT ON compaction_records
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM messages
    WHERE id = NEW.summary_message_id
      AND session_id = NEW.session_id
      AND role = 'system'
  ) THEN RAISE(ABORT, 'compaction summary must be a system message in the same session') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM messages
    WHERE id = NEW.summary_message_id
      AND sequence_num BETWEEN NEW.start_sequence AND NEW.end_sequence
  ) THEN RAISE(ABORT, 'compaction summary cannot be inside its source range') END;
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM messages
    WHERE session_id = NEW.session_id
      AND sequence_num BETWEEN NEW.start_sequence AND NEW.end_sequence
  ) != NEW.end_sequence - NEW.start_sequence + 1
  THEN RAISE(ABORT, 'compaction source range must be complete and belong to the session') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM compaction_records existing
    WHERE existing.session_id = NEW.session_id
      AND NEW.start_sequence <= existing.end_sequence
      AND NEW.end_sequence >= existing.start_sequence
  ) THEN RAISE(ABORT, 'compaction source range overlaps an existing range') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM compaction_records existing
    JOIN messages summary ON summary.id = existing.summary_message_id
    WHERE existing.session_id = NEW.session_id
      AND summary.sequence_num BETWEEN NEW.start_sequence AND NEW.end_sequence
  ) THEN RAISE(ABORT, 'compaction source range contains an existing summary') END;
END;

CREATE TEMP TABLE compaction_summary_ids_to_delete (
  id TEXT PRIMARY KEY
);
INSERT INTO compaction_summary_ids_to_delete (id)
SELECT summary_message_id FROM compaction_records;

DROP TRIGGER IF EXISTS trg_compaction_records_validate;
DROP INDEX IF EXISTS idx_compaction_records_session_seq;
DROP TABLE IF EXISTS compaction_records;
DELETE FROM messages
WHERE id IN (SELECT id FROM compaction_summary_ids_to_delete);
DROP TABLE compaction_summary_ids_to_delete;

-- Reversible down migration for initial schema
DROP INDEX IF EXISTS idx_open_sessions_tab_order;
DROP TABLE IF EXISTS open_sessions;

DROP INDEX IF EXISTS idx_mailbox_task;
DROP INDEX IF EXISTS idx_mailbox_pending_drain;
DROP TABLE IF EXISTS mailbox_events;

DROP INDEX IF EXISTS idx_tasks_status;
DROP INDEX IF EXISTS idx_tasks_worker;
DROP INDEX IF EXISTS idx_tasks_parent_status;
DROP TABLE IF EXISTS tasks;

DROP INDEX IF EXISTS idx_messages_tool_call_id;
DROP INDEX IF EXISTS idx_messages_run_id;
DROP INDEX IF EXISTS idx_messages_session_seq;
DROP TABLE IF EXISTS messages;

DROP INDEX IF EXISTS idx_runs_status;
DROP INDEX IF EXISTS idx_runs_session_started;
DROP TABLE IF EXISTS runs;

DROP INDEX IF EXISTS idx_sessions_agent_name;
DROP INDEX IF EXISTS idx_sessions_created_at;
DROP INDEX IF EXISTS idx_sessions_updated_at;
DROP TABLE IF EXISTS sessions;

DROP TABLE IF EXISTS schema_migrations;

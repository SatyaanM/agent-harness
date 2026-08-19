-- Schema Migrations Table
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  checksum TEXT NOT NULL
);

-- Sessions Table (Durable Conversation Root)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  title TEXT,
  prompt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  metadata TEXT,
  CONSTRAINT chk_session_id_nonempty CHECK (length(id) > 0),
  CONSTRAINT chk_agent_name_nonempty CHECK (length(agent_name) > 0)
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_agent_name ON sessions(agent_name);

-- Runs Table (Bounded Execution Invocations)
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  request_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  model TEXT,
  token_usage TEXT,
  error_code TEXT,
  error_message TEXT,
  CONSTRAINT chk_run_completed_after_started CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_runs_session_started ON runs(session_id, started_at ASC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

-- Messages Table (Ordered Transcript with Total Ordering)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(run_id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  reasoning TEXT,
  tool_calls TEXT,
  tool_call_id TEXT,
  sequence_num INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  metadata TEXT,
  CONSTRAINT uq_session_sequence UNIQUE (session_id, sequence_num),
  CONSTRAINT chk_sequence_num_nonnegative CHECK (sequence_num >= 0)
);

CREATE INDEX IF NOT EXISTS idx_messages_session_seq ON messages(session_id, sequence_num ASC);
CREATE INDEX IF NOT EXISTS idx_messages_run_id ON messages(run_id);
CREATE INDEX IF NOT EXISTS idx_messages_tool_call_id ON messages(tool_call_id) WHERE tool_call_id IS NOT NULL;

-- Tasks Table (Delegated Background Worker Tasks)
CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  worker_session_id TEXT UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'abandoned')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  error_code TEXT,
  error_message TEXT,
  CONSTRAINT chk_task_completed_after_created CHECK (completed_at IS NULL OR completed_at >= created_at)
);

CREATE INDEX IF NOT EXISTS idx_tasks_parent_status ON tasks(parent_session_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_worker ON tasks(worker_session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- Mailbox Events Table (Durable Completion Deliveries)
CREATE TABLE IF NOT EXISTS mailbox_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL DEFAULT 'worker_completed' CHECK (event_type IN ('worker_completed', 'worker_abandoned', 'diagnostic')),
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'acknowledged', 'rejected')),
  created_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  CONSTRAINT uq_parent_task_event UNIQUE (parent_session_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_mailbox_pending_drain ON mailbox_events(parent_session_id, status, id ASC);
CREATE INDEX IF NOT EXISTS idx_mailbox_task ON mailbox_events(task_id);

-- Open Sessions Table (Tab Projection State)
CREATE TABLE IF NOT EXISTS open_sessions (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  tab_order INTEGER NOT NULL UNIQUE,
  is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
  CONSTRAINT chk_tab_order_nonnegative CHECK (tab_order >= 0)
);

CREATE INDEX IF NOT EXISTS idx_open_sessions_tab_order ON open_sessions(tab_order ASC);

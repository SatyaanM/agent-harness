import crypto from "node:crypto";
import type { ISqliteDatabase, MigrationFile, SchemaMigrationRow } from "./types.js";

export type { MigrationFile, SchemaMigrationRow };

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export class ChecksumMismatchError extends MigrationError {
  public readonly migrationName: string;

  constructor(
    public readonly version: number,
    migrationName: string,
    public readonly expectedChecksum: string,
    public readonly actualChecksum: string,
  ) {
    super(
      `Migration ${version} (${migrationName}) checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`,
    );
    this.name = "ChecksumMismatchError";
    this.migrationName = migrationName;
  }
}

export const INITIAL_SCHEMA_UP = `-- Schema Migrations Table
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

CREATE INDEX IF NOT EXISTS idx_open_sessions_tab_order ON open_sessions(tab_order ASC);`;

export const INITIAL_SCHEMA_DOWN = `-- Reversible down migration for initial schema
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

DROP TABLE IF EXISTS schema_migrations;`;

export const AUDIT_EVENTS_UP = `-- Migration 002: Tamper-Evident Cryptographic Audit Ledger Table
CREATE TABLE IF NOT EXISTS audit_events (
  seq_id INTEGER PRIMARY KEY AUTOINCREMENT,
  prev_hash TEXT NOT NULL,
  current_hash TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  signature TEXT,
  CONSTRAINT chk_audit_seq_id_positive CHECK (seq_id > 0),
  CONSTRAINT chk_audit_prev_hash_len CHECK (length(prev_hash) = 64),
  CONSTRAINT chk_audit_current_hash_len CHECK (length(current_hash) = 64),
  CONSTRAINT chk_audit_actor_id_nonempty CHECK (length(actor_id) > 0),
  CONSTRAINT chk_audit_action_nonempty CHECK (length(action) > 0),
  CONSTRAINT chk_audit_resource_type_nonempty CHECK (length(resource_type) > 0),
  CONSTRAINT chk_audit_resource_id_nonempty CHECK (length(resource_id) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_current_hash ON audit_events(current_hash);
CREATE INDEX IF NOT EXISTS idx_audit_events_action_ts ON audit_events(action, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_resource ON audit_events(resource_type, resource_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events(actor_type, actor_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp ON audit_events(timestamp DESC);`;

export const AUDIT_EVENTS_DOWN = `-- Reversible down migration for audit events
DROP INDEX IF EXISTS idx_audit_events_timestamp;
DROP INDEX IF EXISTS idx_audit_events_actor;
DROP INDEX IF EXISTS idx_audit_events_resource;
DROP INDEX IF EXISTS idx_audit_events_action_ts;
DROP INDEX IF EXISTS idx_audit_events_current_hash;
DROP TABLE IF EXISTS audit_events;`;

export const COMPACTION_RECORDS_UP = `-- Migration 003: Compaction Records
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
`;

export const COMPACTION_RECORDS_DOWN = `-- Down migration for compaction records
DROP TRIGGER IF EXISTS trg_compaction_records_validate;
DROP INDEX IF EXISTS idx_compaction_records_session_seq;
DROP TABLE IF EXISTS compaction_records;
`;

export const BUILTIN_MIGRATIONS: readonly MigrationFile[] = Object.freeze([
  {
    version: 1,
    name: "001_initial_schema",
    upSql: INITIAL_SCHEMA_UP,
    downSql: INITIAL_SCHEMA_DOWN,
  },
  {
    version: 2,
    name: "002_audit_events",
    upSql: AUDIT_EVENTS_UP,
    downSql: AUDIT_EVENTS_DOWN,
  },
  {
    version: 3,
    name: "003_compaction_records",
    upSql: COMPACTION_RECORDS_UP,
    downSql: COMPACTION_RECORDS_DOWN,
  },
]);

export function computeSqlChecksum(sql: string): string {
  return crypto.createHash("sha256").update(sql.trim()).digest("hex");
}

export class SqliteMigrator {
  private readonly migrations: readonly MigrationFile[];

  constructor(
    private readonly db: ISqliteDatabase,
    customMigrations?: readonly MigrationFile[],
  ) {
    this.migrations = customMigrations ?? BUILTIN_MIGRATIONS;
  }

  ensureMigrationTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL,
        checksum TEXT NOT NULL
      );
    `);
  }

  getAppliedMigrations(): SchemaMigrationRow[] {
    this.ensureMigrationTable();
    const stmt = this.db.prepare<[], SchemaMigrationRow>(
      "SELECT version, name, applied_at, checksum FROM schema_migrations ORDER BY version ASC",
    );
    return stmt.all();
  }

  getPendingMigrations(): MigrationFile[] {
    const applied = this.getAppliedMigrations();
    const appliedVersions = new Set(applied.map((m) => m.version));
    return this.migrations
      .filter((m) => !appliedVersions.has(m.version))
      .sort((a, b) => a.version - b.version);
  }

  verifyChecksums(): void {
    const applied = this.getAppliedMigrations();
    const migrationMap = new Map(this.migrations.map((m) => [m.version, m]));

    for (const appliedMigration of applied) {
      const defined = migrationMap.get(appliedMigration.version);
      if (defined) {
        const expectedChecksum = computeSqlChecksum(defined.upSql);
        if (expectedChecksum !== appliedMigration.checksum) {
          throw new ChecksumMismatchError(
            appliedMigration.version,
            appliedMigration.name,
            expectedChecksum,
            appliedMigration.checksum,
          );
        }
      }
    }
  }

  up(): { appliedCount: number; versions: number[] } {
    this.ensureMigrationTable();
    this.verifyChecksums();

    const pending = this.getPendingMigrations();
    if (pending.length === 0) {
      return { appliedCount: 0, versions: [] };
    }

    const appliedVersions: number[] = [];

    this.db.immediateTransaction(() => {
      const insertStmt = this.db.prepare<[number, string, number, string]>(
        "INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)",
      );

      for (const migration of pending) {
        this.db.exec(migration.upSql);
        const checksum = computeSqlChecksum(migration.upSql);
        insertStmt.run(migration.version, migration.name, Date.now(), checksum);
        appliedVersions.push(migration.version);
      }
    })();

    return {
      appliedCount: appliedVersions.length,
      versions: appliedVersions,
    };
  }

  down(targetVersion = 0): { rolledBackCount: number; versions: number[] } {
    this.ensureMigrationTable();
    const applied = this.getAppliedMigrations().sort((a, b) => b.version - a.version);
    const toRollback = applied.filter((m) => m.version > targetVersion);

    if (toRollback.length === 0) {
      return { rolledBackCount: 0, versions: [] };
    }

    const migrationMap = new Map(this.migrations.map((m) => [m.version, m]));
    const rolledBackVersions: number[] = [];

    this.db.immediateTransaction(() => {
      const deleteStmt = this.db.prepare<[number]>(
        "DELETE FROM schema_migrations WHERE version = ?",
      );

      for (const appliedMigration of toRollback) {
        const defined = migrationMap.get(appliedMigration.version);
        if (!defined) {
          throw new MigrationError(
            `Cannot rollback version ${appliedMigration.version}: no down definition found`,
          );
        }
        this.db.exec(defined.downSql);
        try {
          deleteStmt.run(appliedMigration.version);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.toLowerCase().includes("no such table")) {
            throw err;
          }
        }
        rolledBackVersions.push(appliedMigration.version);
      }
    })();

    return {
      rolledBackCount: rolledBackVersions.length,
      versions: rolledBackVersions,
    };
  }
}

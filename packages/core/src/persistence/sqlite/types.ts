/**
 * SQLite Database and Relational Entity Type Definitions.
 *
 * Provides type-safe database driver abstractions, statement wrappers,
 * and database row schemas for SQLite WAL persistence in Agent Harness.
 */

export type SqliteBindValue = string | number | bigint | null | Uint8Array;

export interface ISqliteRunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

export interface ISqliteStatement<
  TBind extends SqliteBindValue[] = SqliteBindValue[],
  TResult = Record<string, unknown>,
> {
  run(...params: TBind): ISqliteRunResult;
  get(...params: TBind): TResult | undefined;
  all(...params: TBind): TResult[];
}

export interface ISqliteDatabase {
  readonly path: string;
  readonly isOpen: boolean;
  exec(sql: string): void;
  prepare<TBind extends SqliteBindValue[] = SqliteBindValue[], TResult = Record<string, unknown>>(
    sql: string,
  ): ISqliteStatement<TBind, TResult>;
  transaction<T>(fn: () => T): () => T;
  immediateTransaction<T>(fn: () => T): () => T;
  pragma(pragmaSql: string): unknown;
  close(): void;
}

export type IDatabaseDriver = ISqliteDatabase;

// --- Database Row Interfaces matching 001_initial_schema.sql ---

export interface SchemaMigrationRow {
  version: number;
  name: string;
  applied_at: number;
  checksum: string;
}

export interface SessionRow {
  id: string;
  agent_name: string;
  title: string | null;
  prompt: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  metadata: string | null; // Validated JSON string
}

export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

export interface RunRow {
  run_id: string;
  session_id: string;
  request_id: string | null;
  status: RunStatus;
  started_at: number;
  completed_at: number | null;
  model: string | null;
  token_usage: string | null; // Validated JSON: TokenUsage
  error_code: string | null;
  error_message: string | null;
}

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface MessageRow {
  id: string;
  session_id: string;
  run_id: string | null;
  role: MessageRole;
  content: string;
  reasoning: string | null;
  tool_calls: string | null; // Validated JSON Array of ToolCall
  tool_call_id: string | null;
  sequence_num: number;
  created_at: number;
  metadata: string | null; // Validated JSON: { meta?: unknown }
}

export interface CompactionRecordRow {
  id: number;
  session_id: string;
  summary_message_id: string;
  start_sequence: number;
  end_sequence: number;
  original_token_estimate: number;
  summary_token_estimate: number;
  compacted_at: number;
  model_used: string;
}

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "abandoned";

export interface TaskRow {
  task_id: string;
  parent_session_id: string;
  worker_session_id: string | null;
  description: string;
  status: TaskStatus;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  error_code: string | null;
  error_message: string | null;
}

export type MailboxEventType = "worker_completed" | "worker_abandoned" | "diagnostic";
export type MailboxEventStatus = "pending" | "acknowledged" | "rejected";

export interface MailboxEventRow {
  id: number;
  parent_session_id: string;
  task_id: string;
  event_type: MailboxEventType;
  payload: string; // Validated JSON: PendingMessage
  status: MailboxEventStatus;
  created_at: number;
  acknowledged_at: number | null;
}

export interface OpenSessionRow {
  session_id: string;
  tab_order: number;
  is_active: number; // 0 or 1
}

export interface MigrationFile {
  version: number;
  name: string;
  upSql: string;
  downSql: string;
}

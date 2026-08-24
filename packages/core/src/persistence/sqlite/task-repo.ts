import { z } from "zod";
import { MAX_WORKERS_PER_SESSION } from "../../contracts/session.js";
import { parseBoundary } from "../../validation.js";
import type { ISqliteDatabase, TaskRow, TaskStatus } from "./types.js";

const TaskStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "abandoned",
]);

const TaskInputSchema = z.object({
  taskId: z.string().min(1).max(128),
  parentSessionId: z.string().min(1).max(128),
  workerSessionId: z.string().max(128).nullable().optional(),
  description: z.string().max(10_000),
  status: TaskStatusSchema.optional(),
  createdAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
  completedAt: z.number().int().nonnegative().nullable().optional(),
  errorCode: z.string().max(128).nullable().optional(),
  errorMessage: z.string().max(10_000).nullable().optional(),
});

export class TaskRepository {
  constructor(private readonly db: ISqliteDatabase) {}

  create(input: {
    taskId: string;
    parentSessionId: string;
    workerSessionId?: string | null;
    description: string;
    status?: TaskStatus;
    createdAt?: number;
    updatedAt?: number;
    completedAt?: number | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): TaskRow {
    const validated = parseBoundary(TaskInputSchema, input, "TaskRepository.create");
    const now = Date.now();
    const createdAt = validated.createdAt ?? now;
    const updatedAt = validated.updatedAt ?? createdAt;
    const status = validated.status ?? "running";
    const workerSessionId = validated.workerSessionId ?? null;
    const completedAt = validated.completedAt ?? null;
    const errorCode = validated.errorCode ?? null;
    const errorMessage = validated.errorMessage ?? null;

    const stmt = this.db.prepare<
      [
        string,
        string,
        string | null,
        string,
        string,
        number,
        number,
        number | null,
        string | null,
        string | null,
      ]
    >(
      `INSERT INTO tasks (task_id, parent_session_id, worker_session_id, description, status, created_at, updated_at, completed_at, error_code, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    stmt.run(
      validated.taskId,
      validated.parentSessionId,
      workerSessionId,
      validated.description,
      status,
      createdAt,
      updatedAt,
      completedAt,
      errorCode,
      errorMessage,
    );

    return {
      task_id: validated.taskId,
      parent_session_id: validated.parentSessionId,
      worker_session_id: workerSessionId,
      description: validated.description,
      status,
      created_at: createdAt,
      updated_at: updatedAt,
      completed_at: completedAt,
      error_code: errorCode,
      error_message: errorMessage,
    };
  }

  get(taskId: string): TaskRow | undefined {
    const stmt = this.db.prepare<[string], TaskRow>(
      "SELECT task_id, parent_session_id, worker_session_id, description, status, created_at, updated_at, completed_at, error_code, error_message FROM tasks WHERE task_id = ?",
    );
    return stmt.get(taskId);
  }

  getByWorkerSession(workerSessionId: string): TaskRow | undefined {
    const stmt = this.db.prepare<[string], TaskRow>(
      "SELECT task_id, parent_session_id, worker_session_id, description, status, created_at, updated_at, completed_at, error_code, error_message FROM tasks WHERE worker_session_id = ?",
    );
    return stmt.get(workerSessionId);
  }

  listByParent(parentSessionId: string, status?: TaskStatus): TaskRow[] {
    if (status) {
      const stmt = this.db.prepare<[string, string], TaskRow>(
        "SELECT task_id, parent_session_id, worker_session_id, description, status, created_at, updated_at, completed_at, error_code, error_message FROM tasks WHERE parent_session_id = ? AND status = ? ORDER BY created_at ASC",
      );
      return stmt.all(parentSessionId, status);
    }

    const stmt = this.db.prepare<[string], TaskRow>(
      "SELECT task_id, parent_session_id, worker_session_id, description, status, created_at, updated_at, completed_at, error_code, error_message FROM tasks WHERE parent_session_id = ? ORDER BY created_at ASC",
    );
    return stmt.all(parentSessionId);
  }

  listByStatus(statuses: TaskStatus[]): TaskRow[] {
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => "?").join(", ");
    const stmt = this.db.prepare<string[], TaskRow>(
      `SELECT task_id, parent_session_id, worker_session_id, description, status, created_at, updated_at, completed_at, error_code, error_message
       FROM tasks
       WHERE status IN (${placeholders})
       ORDER BY created_at ASC`,
    );
    return stmt.all(...statuses);
  }

  countActiveByParent(parentSessionId: string): number {
    const validatedParentSessionId = parseBoundary(
      z.string().min(1).max(128),
      parentSessionId,
      "TaskRepository.countActiveByParent",
    );
    const stmt = this.db.prepare<[string], { count: number }>(
      `SELECT COUNT(*) AS count
       FROM tasks
       WHERE parent_session_id = ? AND status IN ('running', 'queued')`,
    );
    return Number(stmt.get(validatedParentSessionId)?.count ?? 0);
  }

  update(
    taskId: string,
    updates: {
      status?: TaskStatus;
      completedAt?: number | null;
      updatedAt?: number;
      errorCode?: string | null;
      errorMessage?: string | null;
      workerSessionId?: string | null;
    },
  ): boolean {
    return this.db.immediateTransaction(() => {
      const existing = this.get(taskId);
      if (!existing) return false;

      const status = updates.status ?? existing.status;
      const updatedAt = updates.updatedAt ?? Date.now();
      const completedAt =
        updates.completedAt !== undefined ? updates.completedAt : existing.completed_at;
      const errorCode = updates.errorCode !== undefined ? updates.errorCode : existing.error_code;
      const errorMessage =
        updates.errorMessage !== undefined ? updates.errorMessage : existing.error_message;
      const workerSessionId =
        updates.workerSessionId !== undefined
          ? updates.workerSessionId
          : existing.worker_session_id;

      const stmt = this.db.prepare<
        [string, number | null, number, string | null, string | null, string | null, string]
      >(
        `UPDATE tasks
         SET status = ?, completed_at = ?, updated_at = ?, error_code = ?, error_message = ?, worker_session_id = ?
         WHERE task_id = ?`,
      );

      const res = stmt.run(
        status,
        completedAt,
        updatedAt,
        errorCode,
        errorMessage,
        workerSessionId,
        taskId,
      );
      return Number(res.changes) > 0;
    })();
  }

  delete(taskId: string): boolean {
    const stmt = this.db.prepare<[string]>("DELETE FROM tasks WHERE task_id = ?");
    const res = stmt.run(taskId);
    return Number(res.changes) > 0;
  }

  listWorkerSummaries(
    parentSessionId: string,
    options?: { limit?: number; maxAgeMs?: number },
  ): Array<{
    taskId: string;
    workerSessionId: string | null;
    agentName: string | null;
    description: string;
    status: TaskStatus;
    createdAt: number;
    updatedAt: number;
    completedAt: number | null;
  }> {
    const limit = options?.limit ?? MAX_WORKERS_PER_SESSION;
    const maxAgeMs = options?.maxAgeMs ?? 30 * 60 * 1000;
    const threshold = Date.now() - maxAgeMs;

    const stmt = this.db.prepare<
      [string, number, number],
      {
        task_id: string;
        worker_session_id: string | null;
        agent_name: string | null;
        description: string;
        status: TaskStatus;
        created_at: number;
        updated_at: number;
        completed_at: number | null;
      }
    >(`
      SELECT
        t.task_id,
        t.worker_session_id,
        s.agent_name,
        t.description,
        t.status,
        t.created_at,
        t.updated_at,
        t.completed_at
      FROM tasks t
      LEFT JOIN sessions s ON s.id = t.worker_session_id
      WHERE t.parent_session_id = ?
        AND (
          t.status IN ('running', 'queued')
          OR t.updated_at >= ?
        )
      ORDER BY
        CASE WHEN t.status IN ('running', 'queued') THEN 0 ELSE 1 END ASC,
        t.updated_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(parentSessionId, threshold, limit);
    return rows.map((r) => ({
      taskId: r.task_id,
      workerSessionId: r.worker_session_id,
      agentName: r.agent_name,
      description: r.description,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      completedAt: r.completed_at,
    }));
  }
}

import { z } from "zod";
import { parseBoundary } from "../../validation.js";
import type { ISqliteDatabase, RunRow, RunStatus } from "./types.js";

const RunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

const RunInputSchema = z.object({
  runId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  requestId: z.string().max(128).nullable().optional(),
  status: RunStatusSchema,
  startedAt: z.number().int().nonnegative().optional(),
  completedAt: z.number().int().nonnegative().nullable().optional(),
  model: z.string().max(256).nullable().optional(),
  tokenUsage: z.record(z.unknown()).nullable().optional(),
  errorCode: z.string().max(128).nullable().optional(),
  errorMessage: z.string().max(10_000).nullable().optional(),
});

export class RunRepository {
  constructor(private readonly db: ISqliteDatabase) {}

  create(input: {
    runId: string;
    sessionId: string;
    requestId?: string | null;
    status: RunStatus;
    startedAt?: number;
    completedAt?: number | null;
    model?: string | null;
    tokenUsage?: Record<string, unknown> | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): RunRow {
    const validated = parseBoundary(RunInputSchema, input, "RunRepository.create");
    const startedAt = validated.startedAt ?? Date.now();
    const tokenUsageStr = validated.tokenUsage ? JSON.stringify(validated.tokenUsage) : null;
    const completedAt = validated.completedAt ?? null;
    const requestId = validated.requestId ?? null;
    const model = validated.model ?? null;
    const errorCode = validated.errorCode ?? null;
    const errorMessage = validated.errorMessage ?? null;

    const stmt = this.db.prepare<
      [
        string,
        string,
        string | null,
        string,
        number,
        number | null,
        string | null,
        string | null,
        string | null,
        string | null,
      ]
    >(
      `INSERT INTO runs (run_id, session_id, request_id, status, started_at, completed_at, model, token_usage, error_code, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    stmt.run(
      validated.runId,
      validated.sessionId,
      requestId,
      validated.status,
      startedAt,
      completedAt,
      model,
      tokenUsageStr,
      errorCode,
      errorMessage,
    );

    return {
      run_id: validated.runId,
      session_id: validated.sessionId,
      request_id: requestId,
      status: validated.status,
      started_at: startedAt,
      completed_at: completedAt,
      model,
      token_usage: tokenUsageStr,
      error_code: errorCode,
      error_message: errorMessage,
    };
  }

  get(runId: string): RunRow | undefined {
    const stmt = this.db.prepare<[string], RunRow>(
      "SELECT run_id, session_id, request_id, status, started_at, completed_at, model, token_usage, error_code, error_message FROM runs WHERE run_id = ?",
    );
    return stmt.get(runId);
  }

  listBySession(sessionId: string): RunRow[] {
    const stmt = this.db.prepare<[string], RunRow>(
      "SELECT run_id, session_id, request_id, status, started_at, completed_at, model, token_usage, error_code, error_message FROM runs WHERE session_id = ? ORDER BY started_at ASC",
    );
    return stmt.all(sessionId);
  }

  update(
    runId: string,
    updates: {
      status?: RunStatus;
      completedAt?: number | null;
      tokenUsage?: Record<string, unknown> | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    },
  ): boolean {
    return this.db.immediateTransaction(() => {
      const existing = this.get(runId);
      if (!existing) return false;

      const status = updates.status ?? existing.status;
      const completedAt =
        updates.completedAt !== undefined ? updates.completedAt : existing.completed_at;
      const tokenUsage =
        updates.tokenUsage !== undefined
          ? updates.tokenUsage
            ? JSON.stringify(updates.tokenUsage)
            : null
          : existing.token_usage;
      const errorCode = updates.errorCode !== undefined ? updates.errorCode : existing.error_code;
      const errorMessage =
        updates.errorMessage !== undefined ? updates.errorMessage : existing.error_message;

      const stmt = this.db.prepare<
        [string, number | null, string | null, string | null, string | null, string]
      >(
        `UPDATE runs
         SET status = ?, completed_at = ?, token_usage = ?, error_code = ?, error_message = ?
         WHERE run_id = ?`,
      );

      const res = stmt.run(status, completedAt, tokenUsage, errorCode, errorMessage, runId);
      return Number(res.changes) > 0;
    })();
  }

  delete(runId: string): boolean {
    const stmt = this.db.prepare<[string]>("DELETE FROM runs WHERE run_id = ?");
    const res = stmt.run(runId);
    return Number(res.changes) > 0;
  }
}

import { z } from "zod";
import { parseBoundary } from "../../validation.js";
import type { ISqliteDatabase, MailboxEventRow, MailboxEventType } from "./types.js";

const MailboxEventTypeSchema = z.enum(["worker_completed", "worker_abandoned", "diagnostic"]);

const MailboxInputSchema = z.object({
  parentSessionId: z.string().min(1).max(128),
  taskId: z.string().min(1).max(128),
  eventType: MailboxEventTypeSchema.optional(),
  payload: z.union([z.string(), z.record(z.unknown())]),
  createdAt: z.number().int().nonnegative().optional(),
});

export class MailboxRepository {
  constructor(private readonly db: ISqliteDatabase) {}

  enqueue(input: {
    parentSessionId: string;
    taskId: string;
    eventType?: MailboxEventType;
    payload: string | Record<string, unknown>;
    createdAt?: number;
  }): MailboxEventRow {
    const validated = parseBoundary(MailboxInputSchema, input, "MailboxRepository.enqueue");
    const eventType = validated.eventType ?? "worker_completed";
    const payloadStr =
      typeof validated.payload === "string" ? validated.payload : JSON.stringify(validated.payload);
    const createdAt = validated.createdAt ?? Date.now();

    const stmt = this.db.prepare<[string, string, string, string, number], MailboxEventRow>(
      `INSERT INTO mailbox_events (parent_session_id, task_id, event_type, payload, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)
       ON CONFLICT(parent_session_id, task_id) DO UPDATE SET
         payload = excluded.payload,
         event_type = excluded.event_type,
         status = 'pending',
         created_at = excluded.created_at,
         acknowledged_at = NULL`,
    );

    const res = stmt.run(
      validated.parentSessionId,
      validated.taskId,
      eventType,
      payloadStr,
      createdAt,
    );

    const id = Number(res.lastInsertRowid);

    return {
      id,
      parent_session_id: validated.parentSessionId,
      task_id: validated.taskId,
      event_type: eventType,
      payload: payloadStr,
      status: "pending",
      created_at: createdAt,
      acknowledged_at: null,
    };
  }

  peekPending(parentSessionId: string, limit = 10_000): MailboxEventRow[] {
    const stmt = this.db.prepare<[string, number], MailboxEventRow>(
      `SELECT id, parent_session_id, task_id, event_type, payload, status, created_at, acknowledged_at
       FROM mailbox_events
       WHERE parent_session_id = ? AND status = 'pending'
       ORDER BY id ASC
       LIMIT ?`,
    );
    return stmt.all(parentSessionId, limit);
  }

  acknowledge(id: number, acknowledgedAt = Date.now()): boolean {
    const stmt = this.db.prepare<[number, number]>(
      `UPDATE mailbox_events
       SET status = 'acknowledged', acknowledged_at = ?
       WHERE id = ? AND status = 'pending'`,
    );
    const res = stmt.run(acknowledgedAt, id);
    return Number(res.changes) > 0;
  }

  acknowledgeByParentAndTask(
    parentSessionId: string,
    taskId: string,
    acknowledgedAt = Date.now(),
  ): boolean {
    const stmt = this.db.prepare<[number, string, string]>(
      `UPDATE mailbox_events
       SET status = 'acknowledged', acknowledged_at = ?
       WHERE parent_session_id = ? AND task_id = ? AND status = 'pending'`,
    );
    const res = stmt.run(acknowledgedAt, parentSessionId, taskId);
    return Number(res.changes) > 0;
  }

  reject(id: number): boolean {
    const stmt = this.db.prepare<[number]>(
      `UPDATE mailbox_events
       SET status = 'rejected'
       WHERE id = ?`,
    );
    const res = stmt.run(id);
    return Number(res.changes) > 0;
  }

  countPending(parentSessionId: string): number {
    const stmt = this.db.prepare<[string], { count: number }>(
      "SELECT COUNT(*) as count FROM mailbox_events WHERE parent_session_id = ? AND status = 'pending'",
    );
    const row = stmt.get(parentSessionId);
    return Number(row?.count ?? 0);
  }

  drainPendingEvents(parentSessionId: string, acknowledgedAt = Date.now()): MailboxEventRow[] {
    const pending = this.peekPending(parentSessionId);
    if (pending.length === 0) return [];

    const ackStmt = this.db.prepare<[number, number]>(
      "UPDATE mailbox_events SET status = 'acknowledged', acknowledged_at = ? WHERE id = ?",
    );

    for (const evt of pending) {
      ackStmt.run(acknowledgedAt, evt.id);
    }

    return pending;
  }
}

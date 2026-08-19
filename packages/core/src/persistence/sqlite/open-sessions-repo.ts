import { z } from "zod";
import { parseBoundary } from "../../validation.js";
import type { ISqliteDatabase, OpenSessionRow } from "./types.js";

const OpenSessionInputSchema = z.object({
  sessionId: z.string().min(1).max(128),
  tabOrder: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

export class OpenSessionsRepository {
  constructor(private readonly db: ISqliteDatabase) {}

  getAll(): OpenSessionRow[] {
    const stmt = this.db.prepare<[], OpenSessionRow>(
      "SELECT session_id, tab_order, is_active FROM open_sessions ORDER BY tab_order ASC",
    );
    return stmt.all();
  }

  setAll(sessions: { sessionId: string; tabOrder: number; isActive: boolean }[]): void {
    this.db.immediateTransaction(() => {
      this.db.exec("DELETE FROM open_sessions;");

      const insertStmt = this.db.prepare<[string, number, number]>(
        "INSERT INTO open_sessions (session_id, tab_order, is_active) VALUES (?, ?, ?)",
      );

      for (const s of sessions) {
        insertStmt.run(s.sessionId, s.tabOrder, s.isActive ? 1 : 0);
      }
    })();
  }

  upsertAll(sessions: { sessionId: string; tabOrder: number; isActive: boolean }[]): void {
    this.db.immediateTransaction(() => {
      const insertStmt = this.db.prepare<[string, number, number]>(
        `INSERT INTO open_sessions (session_id, tab_order, is_active)
         VALUES (?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           tab_order = excluded.tab_order,
           is_active = excluded.is_active`,
      );

      for (const s of sessions) {
        insertStmt.run(s.sessionId, s.tabOrder, s.isActive ? 1 : 0);
      }
    })();
  }

  add(sessionId: string, tabOrder?: number, isActive = false): void {
    const validated = parseBoundary(
      OpenSessionInputSchema,
      { sessionId, tabOrder, isActive },
      "OpenSessionsRepository.add",
    );

    let nextTabOrder = validated.tabOrder;
    if (nextTabOrder === undefined) {
      const maxStmt = this.db.prepare<[], { max_order: number }>(
        "SELECT COALESCE(MAX(tab_order), -1) + 1 AS max_order FROM open_sessions",
      );
      const row = maxStmt.get();
      nextTabOrder = Number(row?.max_order ?? 0);
    }

    if (validated.isActive) {
      this.db.exec("UPDATE open_sessions SET is_active = 0 WHERE is_active = 1;");
    }

    const insertStmt = this.db.prepare<[string, number, number]>(
      `INSERT INTO open_sessions (session_id, tab_order, is_active)
       VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         tab_order = excluded.tab_order,
         is_active = excluded.is_active`,
    );

    insertStmt.run(validated.sessionId, nextTabOrder, validated.isActive ? 1 : 0);
  }

  remove(sessionId: string): boolean {
    const stmt = this.db.prepare<[string]>("DELETE FROM open_sessions WHERE session_id = ?");
    const res = stmt.run(sessionId);
    return Number(res.changes) > 0;
  }

  setActive(sessionId: string): void {
    this.db.immediateTransaction(() => {
      this.db.exec("UPDATE open_sessions SET is_active = 0 WHERE is_active = 1;");
      const stmt = this.db.prepare<[string]>(
        "UPDATE open_sessions SET is_active = 1 WHERE session_id = ?",
      );
      stmt.run(sessionId);
    })();
  }
}

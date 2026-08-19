import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { parseBoundary } from "../../validation.js";
import type { ISqliteDatabase, SessionRow } from "./types.js";

const SessionInputSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  agentName: z.string().min(1).max(128),
  title: z.string().max(512).nullable().optional(),
  prompt: z.string().max(1_000_000),
  createdAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
  completedAt: z.number().int().nonnegative().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

export interface SessionMetaListing {
  id: string;
  agentName: string;
  title: string | null;
  prompt: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  messageCount: number;
}

export class SessionRepository {
  constructor(private readonly db: ISqliteDatabase) {}

  create(input: {
    id?: string;
    agentName: string;
    title?: string | null;
    prompt: string;
    createdAt?: number;
    updatedAt?: number;
    completedAt?: number | null;
    metadata?: Record<string, unknown> | null;
  }): SessionRow {
    const validated = parseBoundary(SessionInputSchema, input, "SessionRepository.create");
    const id = validated.id ?? uuidv4();
    const now = Date.now();
    const createdAt = validated.createdAt ?? now;
    const updatedAt = validated.updatedAt ?? createdAt;
    const completedAt = validated.completedAt ?? null;
    const metadataStr = validated.metadata ? JSON.stringify(validated.metadata) : null;
    const title = validated.title ?? null;

    const stmt = this.db.prepare<
      [string, string, string | null, string, number, number, number | null, string | null]
    >(
      `INSERT INTO sessions (id, agent_name, title, prompt, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    stmt.run(
      id,
      validated.agentName,
      title,
      validated.prompt,
      createdAt,
      updatedAt,
      completedAt,
      metadataStr,
    );

    return {
      id,
      agent_name: validated.agentName,
      title,
      prompt: validated.prompt,
      created_at: createdAt,
      updated_at: updatedAt,
      completed_at: null,
      metadata: metadataStr,
    };
  }

  get(id: string): SessionRow | undefined {
    const stmt = this.db.prepare<[string], SessionRow>(
      "SELECT id, agent_name, title, prompt, created_at, updated_at, completed_at, metadata FROM sessions WHERE id = ?",
    );
    return stmt.get(id);
  }

  update(
    id: string,
    updates: {
      title?: string | null;
      prompt?: string;
      completedAt?: number | null;
      metadata?: Record<string, unknown> | null;
      updatedAt?: number;
    },
  ): boolean {
    return this.db.immediateTransaction(() => {
      const existing = this.get(id);
      if (!existing) return false;

      const updatedAt = updates.updatedAt ?? Date.now();
      const title = updates.title !== undefined ? updates.title : existing.title;
      const prompt = updates.prompt ?? existing.prompt;
      const completedAt =
        updates.completedAt !== undefined ? updates.completedAt : existing.completed_at;
      const metadata =
        updates.metadata !== undefined
          ? updates.metadata
            ? JSON.stringify(updates.metadata)
            : null
          : existing.metadata;

      const stmt = this.db.prepare<
        [string | null, string, number | null, string | null, number, string]
      >(
        `UPDATE sessions
         SET title = ?, prompt = ?, completed_at = ?, metadata = ?, updated_at = ?
         WHERE id = ?`,
      );

      const res = stmt.run(title, prompt, completedAt, metadata, updatedAt, id);
      return Number(res.changes) > 0;
    })();
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare<[string]>("DELETE FROM sessions WHERE id = ?");
    const res = stmt.run(id);
    return Number(res.changes) > 0;
  }

  listMeta(options?: {
    limit?: number;
    offset?: number;
    agentName?: string;
  }): SessionMetaListing[] {
    const limit = options?.limit ?? 10_000;
    const offset = options?.offset ?? 0;

    if (options?.agentName) {
      const stmt = this.db.prepare<
        [string, number, number],
        {
          id: string;
          agent_name: string;
          title: string | null;
          prompt: string;
          created_at: number;
          updated_at: number;
          completed_at: number | null;
          message_count: number;
        }
      >(
        `SELECT s.id, s.agent_name, s.title, s.prompt, s.created_at, s.updated_at, s.completed_at,
                (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) as message_count
         FROM sessions s
         WHERE s.agent_name = ?
         ORDER BY s.updated_at DESC
         LIMIT ? OFFSET ?`,
      );
      const rows = stmt.all(options.agentName, limit, offset);
      return rows.map((r) => ({
        id: r.id,
        agentName: r.agent_name,
        title: r.title,
        prompt: r.prompt,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        completedAt: r.completed_at,
        messageCount: Number(r.message_count),
      }));
    }

    const stmt = this.db.prepare<
      [number, number],
      {
        id: string;
        agent_name: string;
        title: string | null;
        prompt: string;
        created_at: number;
        updated_at: number;
        completed_at: number | null;
        message_count: number;
      }
    >(
      `SELECT s.id, s.agent_name, s.title, s.prompt, s.created_at, s.updated_at, s.completed_at,
              (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) as message_count
       FROM sessions s
       ORDER BY s.updated_at DESC
       LIMIT ? OFFSET ?`,
    );
    const rows = stmt.all(limit, offset);
    return rows.map((r) => ({
      id: r.id,
      agentName: r.agent_name,
      title: r.title,
      prompt: r.prompt,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      completedAt: r.completed_at,
      messageCount: Number(r.message_count),
    }));
  }

  listAll(options?: { limit?: number; offset?: number }): SessionRow[] {
    const limit = options?.limit ?? 10_000;
    const offset = options?.offset ?? 0;
    const stmt = this.db.prepare<[number, number], SessionRow>(
      "SELECT id, agent_name, title, prompt, created_at, updated_at, completed_at, metadata FROM sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?",
    );
    return stmt.all(limit, offset);
  }

  count(): number {
    const stmt = this.db.prepare<[], { count: number }>("SELECT COUNT(*) as count FROM sessions");
    const row = stmt.get();
    return Number(row?.count ?? 0);
  }
}

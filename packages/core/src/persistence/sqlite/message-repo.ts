import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { parseBoundary } from "../../validation.js";
import type { ISqliteDatabase, MessageRole, MessageRow } from "./types.js";

const MessageRoleSchema = z.enum(["user", "assistant", "system", "tool"]);

const MessageInputSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  sessionId: z.string().min(1).max(128),
  runId: z.string().max(128).nullable().optional(),
  role: MessageRoleSchema,
  content: z.string().max(10_000_000),
  reasoning: z.string().max(1_000_000).nullable().optional(),
  toolCalls: z.array(z.record(z.unknown())).nullable().optional(),
  toolCallId: z.string().max(256).nullable().optional(),
  sequenceNum: z.number().int().nonnegative().optional(),
  createdAt: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

export class MessageRepository {
  constructor(private readonly db: ISqliteDatabase) {}

  getNextSequenceNum(sessionId: string): number {
    const stmt = this.db.prepare<[string], { next_seq: number }>(
      "SELECT COALESCE(MAX(sequence_num), -1) + 1 AS next_seq FROM messages WHERE session_id = ?",
    );
    const row = stmt.get(sessionId);
    return Number(row?.next_seq ?? 0);
  }

  create(input: {
    id?: string;
    sessionId: string;
    runId?: string | null;
    role: MessageRole;
    content: string;
    reasoning?: string | null;
    toolCalls?: unknown[] | null;
    toolCallId?: string | null;
    sequenceNum?: number;
    createdAt?: number;
    metadata?: Record<string, unknown> | null;
  }): MessageRow {
    const validated = parseBoundary(MessageInputSchema, input, "MessageRepository.create");
    const id = validated.id ?? uuidv4();
    const sequenceNum =
      validated.sequenceNum !== undefined
        ? validated.sequenceNum
        : this.getNextSequenceNum(validated.sessionId);
    const createdAt = validated.createdAt ?? Date.now();
    const runId = validated.runId ?? null;
    const reasoning = validated.reasoning ?? null;
    const toolCallsStr = validated.toolCalls ? JSON.stringify(validated.toolCalls) : null;
    const toolCallId = validated.toolCallId ?? null;
    const metadataStr = validated.metadata ? JSON.stringify(validated.metadata) : null;

    const stmt = this.db.prepare<
      [
        string,
        string,
        string | null,
        string,
        string,
        string | null,
        string | null,
        string | null,
        number,
        number,
        string | null,
      ]
    >(
      `INSERT INTO messages (id, session_id, run_id, role, content, reasoning, tool_calls, tool_call_id, sequence_num, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    stmt.run(
      id,
      validated.sessionId,
      runId,
      validated.role,
      validated.content,
      reasoning,
      toolCallsStr,
      toolCallId,
      sequenceNum,
      createdAt,
      metadataStr,
    );

    return {
      id,
      session_id: validated.sessionId,
      run_id: runId,
      role: validated.role,
      content: validated.content,
      reasoning,
      tool_calls: toolCallsStr,
      tool_call_id: toolCallId,
      sequence_num: sequenceNum,
      created_at: createdAt,
      metadata: metadataStr,
    };
  }

  get(id: string): MessageRow | undefined {
    const stmt = this.db.prepare<[string], MessageRow>(
      "SELECT id, session_id, run_id, role, content, reasoning, tool_calls, tool_call_id, sequence_num, created_at, metadata FROM messages WHERE id = ?",
    );
    return stmt.get(id);
  }

  listBySession(
    sessionId: string,
    options?: {
      limit?: number;
      offset?: number;
      afterSequenceNum?: number;
    },
  ): MessageRow[] {
    const limit = options?.limit ?? 10_000;
    const offset = options?.offset ?? 0;

    if (options?.afterSequenceNum !== undefined) {
      const stmt = this.db.prepare<[string, number, number, number], MessageRow>(
        `SELECT id, session_id, run_id, role, content, reasoning, tool_calls, tool_call_id, sequence_num, created_at, metadata
         FROM messages
         WHERE session_id = ? AND sequence_num > ?
         ORDER BY sequence_num ASC
         LIMIT ? OFFSET ?`,
      );
      return stmt.all(sessionId, options.afterSequenceNum, limit, offset);
    }

    const stmt = this.db.prepare<[string, number, number], MessageRow>(
      `SELECT id, session_id, run_id, role, content, reasoning, tool_calls, tool_call_id, sequence_num, created_at, metadata
       FROM messages
       WHERE session_id = ?
       ORDER BY sequence_num ASC
       LIMIT ? OFFSET ?`,
    );
    return stmt.all(sessionId, limit, offset);
  }

  countBySession(sessionId: string): number {
    const stmt = this.db.prepare<[string], { count: number }>(
      "SELECT COUNT(*) as count FROM messages WHERE session_id = ?",
    );
    const row = stmt.get(sessionId);
    return Number(row?.count ?? 0);
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare<[string]>("DELETE FROM messages WHERE id = ?");
    const res = stmt.run(id);
    return Number(res.changes) > 0;
  }
}

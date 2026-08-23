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
    return this.db.immediateTransaction(() => {
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
    })();
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

  recordCompaction(input: {
    sessionId: string;
    summaryMessageId: string;
    startSequence: number;
    endSequence: number;
    originalTokenEstimate: number;
    summaryTokenEstimate: number;
    compactedAt: number;
    modelUsed: string;
  }): void {
    const stmt = this.db.prepare<[string, string, number, number, number, number, number, string]>(`
      INSERT INTO compaction_records (
        session_id, summary_message_id, start_sequence, end_sequence,
        original_token_estimate, summary_token_estimate, compacted_at, model_used
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      input.sessionId,
      input.summaryMessageId,
      input.startSequence,
      input.endSequence,
      input.originalTokenEstimate,
      input.summaryTokenEstimate,
      input.compactedAt,
      input.modelUsed,
    );
  }

  getCompactedRanges(sessionId: string): Array<{
    start_sequence: number;
    end_sequence: number;
    summary_message_id: string;
  }> {
    const stmt = this.db.prepare<
      [string],
      { start_sequence: number; end_sequence: number; summary_message_id: string }
    >(
      "SELECT start_sequence, end_sequence, summary_message_id FROM compaction_records WHERE session_id = ? ORDER BY start_sequence ASC",
    );
    return stmt.all(sessionId);
  }

  getActiveContext(sessionId: string): MessageRow[] {
    const allMessages = this.listBySession(sessionId);
    const ranges = this.getCompactedRanges(sessionId);

    const activeMessages: MessageRow[] = [];
    const summaryIds = new Set(ranges.map((r) => r.summary_message_id));
    const rangeIndexMap = new Map(ranges.map((r) => [r.start_sequence, r]));

    let currentRange: {
      start_sequence: number;
      end_sequence: number;
      summary_message_id: string;
    } | null = null;

    for (const msg of allMessages) {
      if (summaryIds.has(msg.id)) continue;

      if (rangeIndexMap.has(msg.sequence_num)) {
        currentRange = rangeIndexMap.get(msg.sequence_num) ?? null;
        const summaryMsg = allMessages.find((m) => m.id === currentRange?.summary_message_id);
        if (summaryMsg) {
          activeMessages.push(summaryMsg);
        }
      }

      if (currentRange) {
        if (
          msg.sequence_num >= currentRange.start_sequence &&
          msg.sequence_num <= currentRange.end_sequence
        ) {
          continue;
        } else {
          currentRange = null;
        }
      }

      activeMessages.push(msg);
    }

    return activeMessages;
  }
}

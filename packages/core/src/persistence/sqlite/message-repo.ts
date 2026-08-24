import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { type Message, MessageSchema } from "../../contracts/agent.js";
import { parseBoundary, parseJsonBoundary } from "../../validation.js";
import type { CompactionRecordRow, ISqliteDatabase, MessageRole, MessageRow } from "./types.js";

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

const CompactionInputSchema = z
  .object({
    sessionId: z.string().min(1).max(128),
    summaryMessageId: z.string().min(1).max(128),
    startSequence: z.number().int().nonnegative(),
    endSequence: z.number().int().nonnegative(),
    originalTokenEstimate: z.number().int().nonnegative(),
    summaryTokenEstimate: z.number().int().nonnegative(),
    compactedAt: z.number().int().nonnegative(),
    modelUsed: z.string().min(1).max(256),
  })
  .strict();

const JsonRecordSchema = z.record(z.unknown());
const ToolCallsSchema = z.array(z.record(z.unknown())).max(10_000);

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
    const validated = parseBoundary(
      CompactionInputSchema,
      input,
      "MessageRepository.recordCompaction",
    );
    const stmt = this.db.prepare<[string, string, number, number, number, number, number, string]>(`
      INSERT INTO compaction_records (
        session_id, summary_message_id, start_sequence, end_sequence,
        original_token_estimate, summary_token_estimate, compacted_at, model_used
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      validated.sessionId,
      validated.summaryMessageId,
      validated.startSequence,
      validated.endSequence,
      validated.originalTokenEstimate,
      validated.summaryTokenEstimate,
      validated.compactedAt,
      validated.modelUsed,
    );
  }

  createCompaction(input: {
    sessionId: string;
    summaryContent: string;
    startSequence: number;
    endSequence: number;
    originalTokenEstimate: number;
    summaryTokenEstimate: number;
    compactedAt: number;
    modelUsed: string;
  }): CompactionRecordRow {
    return this.db.immediateTransaction(() => {
      const summary = this.create({
        sessionId: input.sessionId,
        role: "system",
        content: input.summaryContent,
        sequenceNum: this.getNextSequenceNum(input.sessionId),
        createdAt: input.compactedAt,
        metadata: {
          meta: {
            kind: "compaction_summary",
            startSequence: input.startSequence,
            endSequence: input.endSequence,
          },
        },
      });
      this.recordCompaction({
        sessionId: input.sessionId,
        summaryMessageId: summary.id,
        startSequence: input.startSequence,
        endSequence: input.endSequence,
        originalTokenEstimate: input.originalTokenEstimate,
        summaryTokenEstimate: input.summaryTokenEstimate,
        compactedAt: input.compactedAt,
        modelUsed: input.modelUsed,
      });
      const created = this.getCompactionBySummary(summary.id);
      if (!created) throw new Error("Compaction record was not persisted");
      return created;
    })();
  }

  getCompactionBySummary(summaryMessageId: string): CompactionRecordRow | undefined {
    return this.db
      .prepare<[string], CompactionRecordRow>(
        `SELECT id, session_id, summary_message_id, start_sequence, end_sequence,
                original_token_estimate, summary_token_estimate, compacted_at, model_used
         FROM compaction_records WHERE summary_message_id = ?`,
      )
      .get(summaryMessageId);
  }

  getCompactedRanges(sessionId: string): CompactionRecordRow[] {
    const stmt = this.db.prepare<[string], CompactionRecordRow>(
      `SELECT id, session_id, summary_message_id, start_sequence, end_sequence,
              original_token_estimate, summary_token_estimate, compacted_at, model_used
       FROM compaction_records WHERE session_id = ? ORDER BY start_sequence ASC`,
    );
    return stmt.all(sessionId);
  }

  listRange(sessionId: string, startSequence: number, endSequence: number): MessageRow[] {
    return this.db
      .prepare<[string, number, number], MessageRow>(
        `SELECT id, session_id, run_id, role, content, reasoning, tool_calls, tool_call_id,
                sequence_num, created_at, metadata
         FROM messages
         WHERE session_id = ? AND sequence_num BETWEEN ? AND ?
         ORDER BY sequence_num ASC`,
      )
      .all(sessionId, startSequence, endSequence);
  }

  getActiveContext(sessionId: string): MessageRow[] {
    const allMessages = this.db
      .prepare<[string], MessageRow>(
        `SELECT id, session_id, run_id, role, content, reasoning, tool_calls, tool_call_id,
                sequence_num, created_at, metadata
         FROM messages WHERE session_id = ? ORDER BY sequence_num ASC`,
      )
      .all(sessionId);
    const ranges = this.getCompactedRanges(sessionId);

    const activeMessages: MessageRow[] = [];
    const summaryIds = new Set(ranges.map((r) => r.summary_message_id));
    const messagesById = new Map(allMessages.map((message) => [message.id, message]));
    let rangeIndex = 0;

    for (const msg of allMessages) {
      if (summaryIds.has(msg.id)) continue;
      const range = ranges[rangeIndex];
      if (range && msg.sequence_num === range.start_sequence) {
        const summary = messagesById.get(range.summary_message_id);
        if (!summary) throw new Error(`Missing compaction summary ${range.summary_message_id}`);
        activeMessages.push(summary);
      }
      if (
        range &&
        msg.sequence_num >= range.start_sequence &&
        msg.sequence_num <= range.end_sequence
      ) {
        if (msg.sequence_num === range.end_sequence) rangeIndex += 1;
        continue;
      }
      activeMessages.push(msg);
    }

    return activeMessages;
  }

  selectCompactionCandidate(
    sessionId: string,
    options: { keepRecentMessages: number; chunkMessages: number },
  ): MessageRow[] {
    const active = this.getActiveContext(sessionId);
    const summaryIds = new Set(
      this.getCompactedRanges(sessionId).map((record) => record.summary_message_id),
    );
    const eligible = active.slice(0, Math.max(0, active.length - options.keepRecentMessages));
    let candidate: MessageRow[] = [];
    for (const message of eligible) {
      if (summaryIds.has(message.id)) {
        if (candidate.length >= 2) break;
        candidate = [];
        continue;
      }
      const previous = candidate.at(-1);
      if (previous && message.sequence_num !== previous.sequence_num + 1) {
        if (candidate.length >= 2) break;
        candidate = [];
      }
      candidate.push(message);
      if (candidate.length === options.chunkMessages) break;
    }
    return candidate.length >= 2 ? candidate : [];
  }

  toMessage(row: MessageRow): Message {
    const metadata = row.metadata
      ? parseJsonBoundary(JsonRecordSchema, row.metadata, `message ${row.id} metadata`)
      : {};
    const candidate: Record<string, unknown> = {
      role: row.role,
      content: row.content,
      createdAt: new Date(row.created_at).toISOString(),
      ...metadata,
    };
    if (row.role === "assistant") {
      if (row.reasoning !== null) candidate.reasoning = row.reasoning;
      if (row.tool_calls !== null) {
        candidate.toolCalls = parseJsonBoundary(
          ToolCallsSchema,
          row.tool_calls,
          `message ${row.id} tool calls`,
        );
      }
    }
    if (row.role === "tool" && row.tool_call_id !== null) {
      candidate.toolCallId = row.tool_call_id;
    }
    return parseBoundary(MessageSchema, candidate, `message ${row.id}`);
  }
}

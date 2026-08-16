import path from "node:path";
import fs from "fs-extra";
import { MAX_SESSION_MAILBOX_BYTES, MAX_SESSION_TRANSCRIPT_BYTES } from "../contracts/limits.js";
import {
  createSessionData,
  type PendingMessage,
  PendingMessageSchema,
  type SessionData,
  SessionDataSchema,
  SessionIdSchema,
} from "../contracts/session.js";

export { createSessionData };

import { readUtf8FileBounded, stringifyJsonBounded } from "../filesystem/bounded-io.js";
import { BoundaryValidationError, parseBoundary, parseJsonBoundary } from "../validation.js";
import { getSessionIndex, type SessionMeta } from "./session-index.js";

const MAX_SESSION_MAILBOX_MESSAGES = 10_000;
const MAX_SESSION_FILES = 10_000;

export interface SessionRecordDiagnostic {
  kind: "transcript" | "mailbox";
  record: string;
  message: string;
}

export interface SessionListResult {
  sessions: SessionData[];
  diagnostics: SessionRecordDiagnostic[];
}

export type { PendingMessage, SessionData } from "../contracts/session.js";
export { PendingMessageSchema, SessionDataSchema } from "../contracts/session.js";

/** A detached copy of a session so callers can safely mutate their own state. */
function cleanSession(session: SessionData): SessionData {
  return {
    ...session,
    messages: session.messages || [],
    mailbox: session.mailbox ? [...session.mailbox] : undefined,
  };
}

/**
 * ADR §10.7–10.8 — Durable storage, the single-writer rule.
 *
 * One code path owns all session file I/O: callers submit full-state snapshots
 * and the store is the only thing that touches disk. Two stores, two durability
 * profiles:
 *
 * 1. **Transcript** (`sessions/<id>.json`) — latest-state-wins. Writes to a
 *    given session are serialized (one in flight at a time), different sessions
 *    write in parallel, every write is atomic (temp file + rename), and a flush
 *    drains everything queued for that session in one operation (each snapshot
 *    is full state, so the newest is the merged result).
 * 2. **Mailbox** (`sessions/<id>.mailbox.jsonl`) — lossless, ordered,
 *    append-only log. Appends are never coalesced or collapsed. A message is
 *    removed only by explicit acknowledgement after transcript materialization,
 *    never merely because it was read.
 *
 * The mailbox log is committed independently of the transcript snapshot, so a
 * coalesced transcript write can never drop an undelivered message.
 */

type PendingOp =
  | {
      kind: "write";
      snapshot: SessionData;
      resolve: (filePath: string) => void;
      reject: (err: unknown) => void;
    }
  | {
      kind: "delete";
      resolve: () => void;
      reject: (err: unknown) => void;
    };

class TranscriptState {
  private filePath: string;
  private queue: PendingOp[] = [];
  private flushing = false;
  private latest: SessionData | null = null;

  constructor(
    dir: string,
    readonly sessionId: string,
  ) {
    this.filePath = path.join(dir, `${sessionId}.json`);
  }

  save(snapshot: SessionData): Promise<string> {
    const transcript = { ...parseBoundary(SessionDataSchema, snapshot, "session save") };
    delete transcript.mailbox;
    this.latest = transcript;
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ kind: "write", snapshot: transcript, resolve, reject });
      void this.flush();
    });
  }

  async delete(): Promise<void> {
    this.latest = null;
    await new Promise<void>((resolve, reject) => {
      this.queue.push({ kind: "delete", resolve, reject });
      void this.flush();
    });
  }

  /** The most recent submitted snapshot, if a write is still queued or in flight. */
  peek(): SessionData | null {
    return this.latest;
  }

  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.queue.length > 0) {
        const batch = this.queue;
        this.queue = [];
        try {
          const last = batch[batch.length - 1];
          if (!last) continue;
          if (last.kind === "delete") {
            await fs.remove(this.filePath);
          } else {
            await atomicWrite(this.filePath, last.snapshot);
          }
          for (const op of batch) {
            if (op.kind === "write") op.resolve(this.filePath);
            else op.resolve();
          }
        } catch (err) {
          for (const op of batch) op.reject(err);
          throw err;
        }
      }
    } catch {
      const remaining = this.queue;
      this.queue = [];
      for (const op of remaining) op.reject(new Error("Session flush aborted"));
    } finally {
      this.flushing = false;
      if (this.queue.length === 0) this.latest = null;
      if (this.queue.length > 0) void this.flush();
    }
  }
}

async function atomicWrite(filePath: string, snapshot: SessionData): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  try {
    await fs.writeFile(
      tmpPath,
      stringifyJsonBounded(snapshot, MAX_SESSION_TRANSCRIPT_BYTES, "session transcript"),
      "utf8",
    );
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await fs.remove(tmpPath).catch(() => undefined);
    throw err;
  }
}

/** Per-session append-only mailbox log. Ops are serialized per session. */
class MailboxLog {
  private filePath: string;
  private chain: Promise<unknown> = Promise.resolve();
  private messages: PendingMessage[] | null = null;
  private fileExists = false;
  private loadedBytes = 0;

  constructor(
    dir: string,
    readonly sessionId: string,
  ) {
    this.filePath = path.join(dir, `${sessionId}.mailbox.jsonl`);
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.chain.then(op);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async ensureLoaded(): Promise<PendingMessage[]> {
    if (this.messages !== null) return this.messages;
    this.fileExists = await fs.pathExists(this.filePath);
    if (this.fileExists) {
      const text = await readUtf8FileBounded(
        this.filePath,
        MAX_SESSION_MAILBOX_BYTES,
        `session mailbox ${this.sessionId}`,
      );
      this.loadedBytes = Buffer.byteLength(text, "utf8");
      const messages: PendingMessage[] = [];
      for (const [index, line] of text.split("\n").entries()) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        messages.push(
          parseJsonBoundary(
            PendingMessageSchema,
            trimmed,
            `session mailbox ${this.sessionId} line ${index + 1}`,
          ),
        );
      }
      this.messages = messages;
    } else {
      this.messages = [];
    }
    return this.messages;
  }

  append(message: PendingMessage): Promise<void> {
    return this.enqueue(async () => {
      const parsed = parseBoundary(
        PendingMessageSchema,
        message,
        `session mailbox ${this.sessionId} append`,
      );
      const messages = await this.ensureLoaded();
      if (messages.length >= MAX_SESSION_MAILBOX_MESSAGES) {
        throw new BoundaryValidationError(
          `session mailbox ${this.sessionId}`,
          `message count exceeds ${MAX_SESSION_MAILBOX_MESSAGES}`,
        );
      }
      const line = `${JSON.stringify(parsed)}\n`;
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (this.loadedBytes + lineBytes > MAX_SESSION_MAILBOX_BYTES) {
        throw new BoundaryValidationError(
          `session mailbox ${this.sessionId}`,
          `file exceeds ${MAX_SESSION_MAILBOX_BYTES} bytes`,
        );
      }
      await fs.appendFile(this.filePath, line, "utf-8");
      messages.push(parsed);
      this.loadedBytes += lineBytes;
      this.fileExists = true;
    });
  }

  /** Remove acknowledged task identities while preserving later/unmatched messages. */
  acknowledge(taskIds: ReadonlySet<string>): Promise<void> {
    return this.enqueue(async () => {
      const messages = await this.ensureLoaded();
      const remaining = messages.filter((message) => !taskIds.has(message.taskId));
      if (remaining.length === messages.length) return;
      const text = remaining.map((message) => JSON.stringify(message)).join("\n");
      const serialized = text.length > 0 ? `${text}\n` : "";
      const temporaryFile = `${this.filePath}.tmp`;
      try {
        if (remaining.length === 0) {
          await fs.remove(this.filePath);
        } else {
          await fs.writeFile(temporaryFile, serialized, "utf-8");
          await fs.rename(temporaryFile, this.filePath);
        }
      } catch (error) {
        await fs.remove(temporaryFile).catch(() => undefined);
        throw error;
      }
      this.messages = remaining;
      this.loadedBytes = Buffer.byteLength(serialized, "utf8");
      this.fileExists = remaining.length > 0;
    });
  }

  /** Read the current queue without consuming it. */
  peek(): Promise<PendingMessage[] | null> {
    return this.enqueue(async () => {
      const messages = await this.ensureLoaded();
      return this.fileExists ? [...messages] : null;
    });
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      this.messages = [];
      this.fileExists = false;
      this.loadedBytes = 0;
      await fs.remove(this.filePath).catch(() => undefined);
    });
  }
}

/** Shared per-session state, keyed by directory + session id. */
const transcriptStates = new Map<string, TranscriptState>();
const mailboxLogs = new Map<string, MailboxLog>();

function getTranscriptState(sessionsDir: string, sessionId: string): TranscriptState {
  const key = `${sessionsDir}\u0000${sessionId}`;
  let state = transcriptStates.get(key);
  if (!state) {
    state = new TranscriptState(sessionsDir, sessionId);
    transcriptStates.set(key, state);
  }
  return state;
}

function getMailboxLog(sessionsDir: string, sessionId: string): MailboxLog {
  const key = `${sessionsDir}\u0000${sessionId}`;
  let log = mailboxLogs.get(key);
  if (!log) {
    log = new MailboxLog(sessionsDir, sessionId);
    mailboxLogs.set(key, log);
  }
  return log;
}

async function readTranscript(sessionsDir: string, sessionId: string): Promise<SessionData | null> {
  const filePath = path.join(sessionsDir, `${sessionId}.json`);
  if (await fs.pathExists(filePath)) {
    return parseJsonBoundary(
      SessionDataSchema,
      await readUtf8FileBounded(
        filePath,
        MAX_SESSION_TRANSCRIPT_BYTES,
        `session transcript ${sessionId}`,
      ),
      `session transcript ${sessionId}`,
    );
  }
  return null;
}

export class SessionStore {
  private sessionsDir: string;

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
    fs.ensureDirSync(this.sessionsDir);
  }

  async save(session: SessionData): Promise<string> {
    const parsed = parseBoundary(SessionDataSchema, session, "session store save");
    const result = await getTranscriptState(this.sessionsDir, parsed.sessionId).save(parsed);
    await getSessionIndex(this.sessionsDir).upsert(parsed);
    return result;
  }

  /** Append to the durable, ordered mailbox. Never coalesced. */
  async appendMailbox(sessionId: string, pending: PendingMessage): Promise<void> {
    const parsedSessionId = parseBoundary(SessionIdSchema, sessionId, "session identifier");
    await getMailboxLog(this.sessionsDir, parsedSessionId).append(pending);
  }

  /** Read pending delivery without consuming it. */
  async peekMailbox(sessionId: string): Promise<PendingMessage[]> {
    const parsedSessionId = parseBoundary(SessionIdSchema, sessionId, "session identifier");
    return (await getMailboxLog(this.sessionsDir, parsedSessionId).peek()) ?? [];
  }

  /** Acknowledge task identities only after their transcript projection is durable. */
  async acknowledgeMailbox(sessionId: string, taskIds: readonly string[]): Promise<void> {
    const parsedSessionId = parseBoundary(SessionIdSchema, sessionId, "session identifier");
    const parsedTaskIds = taskIds.map((taskId) =>
      parseBoundary(SessionIdSchema, taskId, "mailbox task identifier"),
    );
    await getMailboxLog(this.sessionsDir, parsedSessionId).acknowledge(new Set(parsedTaskIds));
  }

  async load(sessionId: string): Promise<SessionData | null> {
    const parsedSessionId = parseBoundary(SessionIdSchema, sessionId, "session identifier");
    const state = getTranscriptState(this.sessionsDir, parsedSessionId);
    const latest = state.peek();
    const transcript = latest ?? (await readTranscript(this.sessionsDir, parsedSessionId));
    if (!transcript) return null;
    const mailbox = await getMailboxLog(this.sessionsDir, parsedSessionId).peek();
    return cleanSession({
      ...transcript,
      mailbox: mailbox ?? transcript.mailbox ?? [],
    });
  }

  async list(): Promise<SessionData[]> {
    const result = await this.listWithDiagnostics();
    for (const diagnostic of result.diagnostics) {
      console.error(
        `[sessions] Invalid durable ${diagnostic.kind} record ${diagnostic.record}: ${diagnostic.message}`,
      );
    }
    return result.sessions;
  }

  async listWithDiagnostics(): Promise<SessionListResult> {
    const sessions = new Map<string, SessionData>();
    const diagnostics: SessionRecordDiagnostic[] = [];

    for (const [key, state] of transcriptStates) {
      if (!key.startsWith(`${this.sessionsDir}\u0000`)) continue;
      const latest = state.peek();
      if (latest) sessions.set(state.sessionId, latest);
      if (sessions.size > MAX_SESSION_FILES) {
        throw new BoundaryValidationError(
          "session listing",
          `session count exceeds ${MAX_SESSION_FILES}`,
        );
      }
    }

    const directory = await fs.opendir(this.sessionsDir);
    for await (const entry of directory) {
      if (!entry.isFile()) continue;
      const file = entry.name;
      if (!file.endsWith(".json")) continue;
      if (file === ".index.json") continue;
      const sessionId = file.slice(0, -".json".length);
      if (sessions.has(sessionId)) continue;
      if (sessions.size >= MAX_SESSION_FILES) {
        throw new BoundaryValidationError(
          "session listing",
          `session count exceeds ${MAX_SESSION_FILES}`,
        );
      }
      try {
        const session = parseJsonBoundary(
          SessionDataSchema,
          await readUtf8FileBounded(
            path.join(this.sessionsDir, file),
            MAX_SESSION_TRANSCRIPT_BYTES,
            `session transcript ${sessionId}`,
          ),
          `session transcript ${sessionId}`,
        );
        sessions.set(sessionId, session);
      } catch (error) {
        diagnostics.push({
          kind: "transcript",
          record: file,
          message: diagnosticMessage(error),
        });
      }
    }

    const result: SessionData[] = [];
    for (const [sessionId, session] of sessions) {
      try {
        const mailbox = await getMailboxLog(this.sessionsDir, sessionId).peek();
        result.push(
          cleanSession({
            ...session,
            mailbox: mailbox ?? session.mailbox ?? [],
          }),
        );
      } catch (error) {
        diagnostics.push({
          kind: "mailbox",
          record: `${sessionId}.mailbox.jsonl`,
          message: diagnosticMessage(error),
        });
        result.push(cleanSession(session));
      }
    }

    return {
      sessions: result.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
      diagnostics,
    };
  }

  async delete(sessionId: string): Promise<void> {
    const parsedSessionId = parseBoundary(SessionIdSchema, sessionId, "session identifier");
    await getTranscriptState(this.sessionsDir, parsedSessionId).delete();
    await getMailboxLog(this.sessionsDir, parsedSessionId).clear();
    transcriptStates.delete(`${this.sessionsDir}\u0000${parsedSessionId}`);
    mailboxLogs.delete(`${this.sessionsDir}\u0000${parsedSessionId}`);
    await getSessionIndex(this.sessionsDir).remove(parsedSessionId);
  }

  /** Rebuild the metadata index from transcripts if it is missing. */
  async ensureIndexBuilt(): Promise<void> {
    await getSessionIndex(this.sessionsDir).ensureBuilt(() => this.list());
  }

  /** Metadata for listing/searching — cheap, reads the index, not transcripts. */
  async listMeta(): Promise<SessionMeta[]> {
    return getSessionIndex(this.sessionsDir).list();
  }
}

function diagnosticMessage(error: unknown): string {
  return error instanceof BoundaryValidationError
    ? "Record is invalid or exceeds its configured limit."
    : "Record could not be read.";
}

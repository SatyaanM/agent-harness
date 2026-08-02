import fs from "fs-extra";
import path from "path";
import type { Message, TaskId } from "../agent/types.js";

export interface PendingMessage {
  taskId: TaskId;
  from: string;
  agentName: string;
  status: "done" | "error" | "cancelled";
  summary: string;
  receivedAt: string;
}

export interface SessionData {
  sessionId: string;
  taskId: TaskId;
  prompt: string;
  messages: Message[];
  agentName?: string;
  mailbox?: PendingMessage[];
  result?: {
    status: string;
    summary: string;
  };
  createdAt: string;
  completedAt?: string;
}

function stripToolCallXml(content: string): string {
  let cleaned = content;

  const toolCallStart = "<" + "tool_call>";
  const toolCallEnd = "</" + "tool_call>";
  while (true) {
    const startIdx = cleaned.indexOf(toolCallStart);
    if (startIdx === -1) break;
    const endIdx = cleaned.indexOf(toolCallEnd, startIdx);
    if (endIdx === -1) break;
    cleaned = cleaned.slice(0, startIdx) + cleaned.slice(endIdx + toolCallEnd.length);
  }

  const toolResultStart = "<" + "tool_result>";
  const toolResultEnd = "</" + "tool_result>";
  while (true) {
    const startIdx = cleaned.indexOf(toolResultStart);
    if (startIdx === -1) break;
    const endIdx = cleaned.indexOf(toolResultEnd, startIdx);
    if (endIdx === -1) break;
    cleaned = cleaned.slice(0, startIdx) + cleaned.slice(endIdx + toolResultEnd.length);
  }

  return cleaned.trim();
}

function cleanMessages(messages: Message[]): Message[] {
  return messages.map((msg) => {
    if (msg.content && typeof msg.content === "string") {
      return { ...msg, content: stripToolCallXml(msg.content) };
    }
    return msg;
  });
}

/** A cleaned, detached copy of a session so callers can safely mutate their own state. */
function cleanSession(session: SessionData): SessionData {
  return {
    ...session,
    messages: cleanMessages(session.messages || []),
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
 *    removed only by `drainMailbox`, i.e. tied to delivery, never to a write.
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
    private readonly dir: string,
    readonly sessionId: string,
  ) {
    this.filePath = path.join(dir, `${sessionId}.json`);
  }

  save(snapshot: SessionData): Promise<string> {
    const transcript = { ...snapshot };
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
    await fs.writeJson(tmpPath, snapshot, { spaces: 2 });
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

  constructor(
    private readonly dir: string,
    readonly sessionId: string,
  ) {
    this.filePath = path.join(dir, `${sessionId}.mailbox.jsonl`);
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.chain.then(op);
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.messages !== null) return;
    this.fileExists = await fs.pathExists(this.filePath);
    if (this.fileExists) {
      const text = await fs.readFile(this.filePath, "utf-8");
      this.messages = [];
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          this.messages.push(JSON.parse(trimmed) as PendingMessage);
        } catch {
          // Tolerate a corrupt line rather than failing the whole log.
        }
      }
    } else {
      this.messages = [];
    }
  }

  append(message: PendingMessage): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      this.messages!.push(message);
      await fs.appendFile(this.filePath, JSON.stringify(message) + "\n", "utf-8");
      this.fileExists = true;
    });
  }

  /** Atomically removes the whole queue (tied to delivery) and returns it. */
  drain(): Promise<PendingMessage[]> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const delivered = this.messages!;
      if (this.fileExists) {
        await fs.writeFile(this.filePath, "", "utf-8");
      }
      this.messages = [];
      return delivered;
    });
  }

  /** Read the current queue without consuming it. */
  peek(): Promise<PendingMessage[] | null> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      return this.fileExists ? [...this.messages!] : null;
    });
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      this.messages = [];
      this.fileExists = false;
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

async function readTranscript(
  sessionsDir: string,
  sessionId: string
): Promise<SessionData | null> {
  const filePath = path.join(sessionsDir, `${sessionId}.json`);
  if (await fs.pathExists(filePath)) {
    return fs.readJson(filePath);
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
    return getTranscriptState(this.sessionsDir, session.sessionId).save(session);
  }

  /** Append to the durable, ordered mailbox. Never coalesced. */
  async appendMailbox(sessionId: string, pending: PendingMessage): Promise<void> {
    await getMailboxLog(this.sessionsDir, sessionId).append(pending);
  }

  /** Atomically remove and return the whole pending mailbox. */
  async drainMailbox(sessionId: string): Promise<PendingMessage[]> {
    return getMailboxLog(this.sessionsDir, sessionId).drain();
  }

  async load(sessionId: string): Promise<SessionData | null> {
    const state = getTranscriptState(this.sessionsDir, sessionId);
    const latest = state.peek();
    const transcript = latest ?? (await readTranscript(this.sessionsDir, sessionId));
    if (!transcript) return null;
    const mailbox = await getMailboxLog(this.sessionsDir, sessionId).peek();
    return cleanSession({
      ...transcript,
      mailbox: mailbox ?? transcript.mailbox ?? [],
    });
  }

  async list(): Promise<SessionData[]> {
    const sessions = new Map<string, SessionData>();

    for (const [key, state] of transcriptStates) {
      if (!key.startsWith(`${this.sessionsDir}\u0000`)) continue;
      const latest = state.peek();
      if (latest) sessions.set(state.sessionId, latest);
    }

    const files = await fs.readdir(this.sessionsDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const sessionId = file.slice(0, -".json".length);
      if (sessions.has(sessionId)) continue;
      const session = await fs.readJson(path.join(this.sessionsDir, file));
      sessions.set(sessionId, session);
    }

    const result: SessionData[] = [];
    for (const [sessionId, session] of sessions) {
      const mailbox = await getMailboxLog(this.sessionsDir, sessionId).peek();
      result.push(
        cleanSession({
          ...session,
          mailbox: mailbox ?? session.mailbox ?? [],
        })
      );
    }

    return result.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async delete(sessionId: string): Promise<void> {
    await getTranscriptState(this.sessionsDir, sessionId).delete();
    await getMailboxLog(this.sessionsDir, sessionId).clear();
    transcriptStates.delete(`${this.sessionsDir}\u0000${sessionId}`);
    mailboxLogs.delete(`${this.sessionsDir}\u0000${sessionId}`);
  }
}

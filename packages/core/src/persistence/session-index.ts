import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { SessionIdSchema } from "../contracts/session.js";
import { readUtf8FileBounded, stringifyJsonBounded } from "../filesystem/bounded-io.js";
import { parseJsonBoundary } from "../validation.js";
import type { SessionData } from "./session.js";

/**
 * Lightweight metadata index for sessions (ADR §12 / session-resumption design).
 *
 * The index is *derived data*: a projection of each top-level session's
 * transcript that lets the dashboard list, title, and search sessions without
 * reading and parsing every (potentially hundreds of KB) transcript file.
 *
 * Durability profile is deliberately weaker than the transcript or mailbox
 * (ADR §10.8): eventually consistent, coalesced writes, and rebuildable from
 * the transcripts when the file is missing or corrupt. It is a cache, not a
 * source of truth — the transcript always is.
 *
 * Worker sessions (`worker-*`) are excluded: they belong to their delegating
 * session's lifecycle (ADR §12.5) and are never surfaced as open tabs.
 */

export interface SessionMeta {
  sessionId: string;
  title?: string;
  agentName?: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

const SessionMetaSchema = z
  .object({
    sessionId: SessionIdSchema,
    title: z.string().max(512).optional(),
    agentName: z.string().min(1).max(128).optional(),
    prompt: z.string().max(1_000_000),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    messageCount: z.number().int().nonnegative().max(20_000),
  })
  .strict();
const SessionIndexFileSchema = z
  .object({
    version: z.literal(1),
    sessions: z.record(SessionMetaSchema).refine((value) => Object.keys(value).length <= 10_000),
  })
  .strict();
type SessionIndexFile = z.infer<typeof SessionIndexFileSchema>;
const MAX_SESSION_INDEX_BYTES = 10_000_000;

function isWorkerSession(sessionId: string): boolean {
  return sessionId.startsWith("worker-");
}

/** Per-directory shared index state, so all SessionStore instances agree. */
const indexHandles = new Map<string, IndexHandle>();

export function getSessionIndex(sessionsDir: string): IndexHandle {
  const filePath = path.join(sessionsDir, ".index.json");
  let handle = indexHandles.get(filePath);
  if (!handle) {
    handle = new IndexHandle(filePath);
    indexHandles.set(filePath, handle);
  }
  return handle;
}

export class IndexHandle {
  private state: SessionIndexFile | null = null;
  private loading: Promise<SessionIndexFile> | null = null;
  private building: Promise<void> | null = null;
  private loaded = false;
  private dirty = false;
  private pendingFlush: Promise<void> | null = null;

  constructor(private readonly filePath: string) {}

  private ensureLoaded(): Promise<SessionIndexFile> {
    if (this.state) return Promise.resolve(this.state);
    if (this.loading) return this.loading;
    this.loading = (async () => {
      let state: SessionIndexFile = { version: 1, sessions: {} };
      try {
        if (await fs.pathExists(this.filePath)) {
          state = parseJsonBoundary(
            SessionIndexFileSchema,
            await readUtf8FileBounded(
              this.filePath,
              MAX_SESSION_INDEX_BYTES,
              "session metadata index",
            ),
            "session metadata index",
          );
          this.loaded = true;
        }
      } catch {
        // Corrupt or unreadable: start empty; it will be rebuilt on demand.
      }
      this.state = state;
      return state;
    })();
    return this.loading;
  }

  private metaOf(session: SessionData): SessionMeta | null {
    if (isWorkerSession(session.sessionId)) return null;
    const last = session.messages?.[session.messages.length - 1];
    return {
      sessionId: session.sessionId,
      title: session.title,
      agentName: session.agentName,
      prompt: session.prompt ?? "",
      createdAt: session.createdAt,
      updatedAt: last?.createdAt ?? session.completedAt ?? session.createdAt,
      messageCount: session.messages?.length ?? 0,
    };
  }

  async upsert(session: SessionData): Promise<void> {
    const meta = this.metaOf(session);
    if (!meta) return;
    const state = await this.ensureLoaded();
    state.sessions[session.sessionId] = meta;
    this.markDirty();
  }

  async remove(sessionId: string): Promise<void> {
    const state = await this.ensureLoaded();
    if (state.sessions[sessionId]) {
      delete state.sessions[sessionId];
      this.markDirty();
    }
  }

  async list(): Promise<SessionMeta[]> {
    const state = await this.ensureLoaded();
    return Object.values(state.sessions);
  }

  /**
   * Rebuild the index from the transcripts when the index file is missing
   * (first run after upgrade, or deleted). If the file exists it is trusted —
   * incremental saves keep it current; a lost tail self-heals on the next save.
   */
  ensureBuilt(rebuildSource: () => Promise<SessionData[]>): Promise<void> {
    if (this.building) return this.building;
    this.building = (async () => {
      await this.ensureLoaded();
      if (this.loaded) return;
      const all = await rebuildSource();
      const state = await this.ensureLoaded();
      state.sessions = {};
      for (const session of all) {
        const meta = this.metaOf(session);
        if (meta) state.sessions[session.sessionId] = meta;
      }
      this.loaded = true;
      this.dirty = true;
      await this.flush();
    })().finally(() => {
      this.building = null;
    });
    return this.building;
  }

  private markDirty(): void {
    this.dirty = true;
    void this.flush().catch(() => {
      this.dirty = true;
      console.error("[session-index] Failed to persist derived metadata index");
    });
  }

  /** Coalesced flush: many dirty upserts become one full-snapshot write. */
  private async flush(): Promise<void> {
    if (this.pendingFlush) return this.pendingFlush;
    const run = (async () => {
      while (this.dirty) {
        this.dirty = false;
        await this.flushNow();
      }
    })().finally(() => {
      this.pendingFlush = null;
    });
    this.pendingFlush = run;
    return run;
  }

  private async flushNow(): Promise<void> {
    const state = await this.ensureLoaded();
    const tmpPath = `${this.filePath}.tmp`;
    try {
      await fs.writeFile(
        tmpPath,
        stringifyJsonBounded(state, MAX_SESSION_INDEX_BYTES, "session metadata index"),
        "utf8",
      );
      await fs.rename(tmpPath, this.filePath);
    } catch (err) {
      await fs.remove(tmpPath).catch(() => undefined);
      throw err;
    }
  }
}

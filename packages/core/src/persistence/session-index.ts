import fs from "fs-extra";
import path from "path";
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

interface SessionIndexFile {
  version: 1;
  sessions: Record<string, SessionMeta>;
}

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
          const raw = JSON.parse(await fs.readFile(this.filePath, "utf-8"));
          if (raw && raw.version === 1 && raw.sessions && typeof raw.sessions === "object") {
            state = raw;
            this.loaded = true;
          }
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
    void this.flush();
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
      await fs.writeJson(tmpPath, state, { spaces: 2 });
      await fs.rename(tmpPath, this.filePath);
    } catch (err) {
      await fs.remove(tmpPath).catch(() => undefined);
      throw err;
    }
  }
}

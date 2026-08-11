import path from "node:path";
import fs from "fs-extra";
import type { TaskId } from "../agent/types.js";

export interface InboxItemMetadata {
  id: string;
  title: string;
  type: string;
  authorAgent: TaskId;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface TrackItemInput {
  title: string;
  type: string;
  authorAgent: TaskId;
}

export class InboxManager {
  private inboxDir: string;
  private metadataFile: string;
  private metadata: Map<string, InboxItemMetadata> = new Map();
  private loaded = false;

  constructor(inboxDir: string) {
    this.inboxDir = inboxDir;
    this.metadataFile = path.join(inboxDir, ".harness", "inbox-metadata.json");
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await fs.ensureDir(path.dirname(this.metadataFile));
    if (await fs.pathExists(this.metadataFile)) {
      const raw: Record<string, InboxItemMetadata> = await fs.readJson(this.metadataFile);
      for (const [key, value] of Object.entries(raw)) {
        this.metadata.set(key, value);
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const obj: Record<string, InboxItemMetadata> = {};
    for (const [key, value] of this.metadata.entries()) {
      obj[key] = value;
    }
    await fs.writeJson(this.metadataFile, obj, { spaces: 2 });
  }

  async trackItem(itemId: string, input: TrackItemInput): Promise<InboxItemMetadata> {
    await this.ensureLoaded();
    const existing = this.metadata.get(itemId);
    const now = new Date().toISOString();
    const entry: InboxItemMetadata = {
      id: itemId,
      title: input.title,
      type: input.type,
      authorAgent: input.authorAgent,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: existing ? existing.version + 1 : 1,
    };
    this.metadata.set(itemId, entry);
    await this.persist();
    return entry;
  }

  async getItemMetadata(itemId: string): Promise<InboxItemMetadata | null> {
    await this.ensureLoaded();
    return this.metadata.get(itemId) ?? null;
  }

  async listItems(): Promise<InboxItemMetadata[]> {
    await this.ensureLoaded();
    return [...this.metadata.values()];
  }

  async deleteItem(itemId: string): Promise<void> {
    await this.ensureLoaded();
    const filePath = path.join(this.inboxDir, itemId);
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
    }
    this.metadata.delete(itemId);
    await this.persist();
  }

  async bumpVersion(itemId: string): Promise<InboxItemMetadata | null> {
    await this.ensureLoaded();
    const existing = this.metadata.get(itemId);
    if (!existing) return null;
    const updated: InboxItemMetadata = {
      ...existing,
      updatedAt: new Date().toISOString(),
      version: existing.version + 1,
    };
    this.metadata.set(itemId, updated);
    await this.persist();
    return updated;
  }

  async renameKey(oldId: string, newId: string): Promise<void> {
    await this.ensureLoaded();
    const existing = this.metadata.get(oldId);
    if (!existing) return;
    this.metadata.set(newId, { ...existing, id: newId });
    this.metadata.delete(oldId);
    await this.persist();
  }

  async untrackRecursive(prefix: string): Promise<void> {
    await this.ensureLoaded();
    let changed = false;
    for (const key of this.metadata.keys()) {
      if (key === prefix || key.startsWith(`${prefix}/`)) {
        this.metadata.delete(key);
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  getInboxDir(): string {
    return this.inboxDir;
  }
}

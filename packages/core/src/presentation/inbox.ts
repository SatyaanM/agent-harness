import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { TaskIdSchema } from "../agent/types.js";
import { readUtf8FileBounded, stringifyJsonBounded } from "../filesystem/bounded-io.js";
import { assertExistingPathWithinRoot } from "../tool/utils.js";
import { BoundaryValidationError, parseBoundary, parseJsonBoundary } from "../validation.js";

const MAX_INBOX_METADATA_BYTES = 10_000_000;
const MAX_INBOX_METADATA_ENTRIES = 10_000;
const InboxItemIdSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine((value) => !value.includes("\0"), "must not contain a null byte")
  .refine((value) => !path.isAbsolute(value), "must be relative")
  .refine(
    (value) => !value.replaceAll("\\", "/").split("/").includes(".."),
    "must not traverse outside the inbox",
  );

export const InboxItemMetadataSchema = z
  .object({
    id: InboxItemIdSchema,
    title: z.string().min(1).max(512),
    type: z.string().min(1).max(128),
    authorAgent: TaskIdSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    version: z.number().int().positive(),
  })
  .strict();
const InboxMetadataFileSchema = z
  .record(InboxItemMetadataSchema)
  .refine((value) => Object.keys(value).length <= MAX_INBOX_METADATA_ENTRIES);

export type InboxItemMetadata = z.infer<typeof InboxItemMetadataSchema>;

const TrackItemInputSchema = z
  .object({
    title: z.string().min(1).max(512),
    type: z.string().min(1).max(128),
    authorAgent: TaskIdSchema,
  })
  .strict();
export type TrackItemInput = z.infer<typeof TrackItemInputSchema>;

interface InboxState {
  metadata: Map<string, InboxItemMetadata>;
  loaded: boolean;
  loading: Promise<void> | null;
  persistQueue: Promise<void>;
}

const states = new Map<string, InboxState>();

function getState(metadataFile: string): InboxState {
  let state = states.get(metadataFile);
  if (!state) {
    state = {
      metadata: new Map(),
      loaded: false,
      loading: null,
      persistQueue: Promise.resolve(),
    };
    states.set(metadataFile, state);
  }
  return state;
}

export class InboxManager {
  private readonly metadataFile: string;
  private readonly state: InboxState;

  constructor(private readonly inboxDir: string) {
    this.metadataFile = path.join(inboxDir, ".harness", "inbox-metadata.json");
    this.state = getState(this.metadataFile);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.state.loaded) return;
    if (this.state.loading) return this.state.loading;
    this.state.loading = (async () => {
      await fs.ensureDir(path.dirname(this.metadataFile));
      if (await fs.pathExists(this.metadataFile)) {
        const parsed = parseJsonBoundary(
          InboxMetadataFileSchema,
          await readUtf8FileBounded(this.metadataFile, MAX_INBOX_METADATA_BYTES, "inbox metadata"),
          "inbox metadata",
        );
        this.state.metadata.clear();
        for (const [key, value] of Object.entries(parsed)) {
          this.state.metadata.set(key, value);
        }
      }
      this.state.loaded = true;
    })().finally(() => {
      this.state.loading = null;
    });
    return this.state.loading;
  }

  private async persist(): Promise<void> {
    const snapshot = Object.fromEntries(this.state.metadata.entries());
    const write = this.state.persistQueue.then(async () => {
      const temporaryFile = `${this.metadataFile}.tmp`;
      try {
        await fs.writeFile(
          temporaryFile,
          stringifyJsonBounded(snapshot, MAX_INBOX_METADATA_BYTES, "inbox metadata"),
          "utf8",
        );
        await fs.rename(temporaryFile, this.metadataFile);
      } catch (error) {
        await fs.remove(temporaryFile).catch(() => undefined);
        throw error;
      }
    });
    this.state.persistQueue = write.catch(() => undefined);
    await write;
  }

  async trackItem(itemId: string, input: TrackItemInput): Promise<InboxItemMetadata> {
    await this.ensureLoaded();
    const parsedItemId = parseBoundary(InboxItemIdSchema, itemId, "inbox item identifier");
    const parsedInput = parseBoundary(TrackItemInputSchema, input, "inbox item metadata");
    const existing = this.state.metadata.get(parsedItemId);
    if (!existing && this.state.metadata.size >= MAX_INBOX_METADATA_ENTRIES) {
      throw new BoundaryValidationError(
        "inbox metadata",
        `entry count exceeds ${MAX_INBOX_METADATA_ENTRIES}`,
      );
    }
    const now = new Date().toISOString();
    const entry: InboxItemMetadata = {
      id: parsedItemId,
      title: parsedInput.title,
      type: parsedInput.type,
      authorAgent: parsedInput.authorAgent,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: existing ? existing.version + 1 : 1,
    };
    this.state.metadata.set(parsedItemId, entry);
    await this.persist();
    return entry;
  }

  async getItemMetadata(itemId: string): Promise<InboxItemMetadata | null> {
    await this.ensureLoaded();
    const parsedItemId = parseBoundary(InboxItemIdSchema, itemId, "inbox item identifier");
    return this.state.metadata.get(parsedItemId) ?? null;
  }

  async listItems(): Promise<InboxItemMetadata[]> {
    await this.ensureLoaded();
    return [...this.state.metadata.values()];
  }

  async deleteItem(itemId: string): Promise<void> {
    await this.ensureLoaded();
    const parsedItemId = parseBoundary(InboxItemIdSchema, itemId, "inbox item identifier");
    const filePath = path.join(this.inboxDir, parsedItemId);
    if (await fs.pathExists(filePath)) {
      await assertExistingPathWithinRoot(filePath, this.inboxDir);
      await fs.remove(filePath);
    }
    this.state.metadata.delete(parsedItemId);
    await this.persist();
  }

  async bumpVersion(itemId: string): Promise<InboxItemMetadata | null> {
    await this.ensureLoaded();
    const parsedItemId = parseBoundary(InboxItemIdSchema, itemId, "inbox item identifier");
    const existing = this.state.metadata.get(parsedItemId);
    if (!existing) return null;
    const updated: InboxItemMetadata = {
      ...existing,
      updatedAt: new Date().toISOString(),
      version: existing.version + 1,
    };
    this.state.metadata.set(parsedItemId, updated);
    await this.persist();
    return updated;
  }

  async renameKey(oldId: string, newId: string): Promise<void> {
    await this.ensureLoaded();
    const parsedOldId = parseBoundary(InboxItemIdSchema, oldId, "old inbox item identifier");
    const parsedNewId = parseBoundary(InboxItemIdSchema, newId, "new inbox item identifier");
    const existing = this.state.metadata.get(parsedOldId);
    if (!existing) return;
    this.state.metadata.set(parsedNewId, { ...existing, id: parsedNewId });
    this.state.metadata.delete(parsedOldId);
    await this.persist();
  }

  async untrackRecursive(prefix: string): Promise<void> {
    await this.ensureLoaded();
    const parsedPrefix = parseBoundary(InboxItemIdSchema, prefix, "inbox item prefix");
    let changed = false;
    for (const key of this.state.metadata.keys()) {
      if (key === parsedPrefix || key.startsWith(`${parsedPrefix}/`)) {
        this.state.metadata.delete(key);
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  getInboxDir(): string {
    return this.inboxDir;
  }
}

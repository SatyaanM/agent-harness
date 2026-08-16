import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { type RegistryEntry, RegistryEntrySchema } from "../capability/types.js";
import { readUtf8FileBounded, stringifyJsonBounded } from "../filesystem/bounded-io.js";
import { parseBoundary, parseJsonBoundary } from "../validation.js";

const CapabilityCacheSchema = z.array(RegistryEntrySchema).max(10_000);
const MAX_CAPABILITY_CACHE_BYTES = 10_000_000;

const CACHE_DIR = ".harness";
const CACHE_FILE = "capabilities.json";

export class CapabilityCache {
  private cachePath: string;
  private entries: RegistryEntry[] = [];
  private loaded = false;

  constructor(workspaceRoot: string) {
    this.cachePath = path.join(workspaceRoot, CACHE_DIR, CACHE_FILE);
  }

  async loadCache(): Promise<RegistryEntry[]> {
    if (this.loaded) return this.entries;
    try {
      const raw = await readUtf8FileBounded(
        this.cachePath,
        MAX_CAPABILITY_CACHE_BYTES,
        "capability cache",
      );
      this.entries = parseJsonBoundary(CapabilityCacheSchema, raw, "capability cache");
    } catch {
      this.entries = [];
    }
    this.loaded = true;
    return this.entries;
  }

  async saveCache(entries: RegistryEntry[]): Promise<void> {
    this.entries = parseBoundary(CapabilityCacheSchema, entries, "capability cache save");
    this.loaded = true;
    const dir = path.dirname(this.cachePath);
    await fs.mkdir(dir, { recursive: true });
    // The temp filename includes `randomUUID()` rather than `Date.now()` +
    // `Math.random()` so two writers can't accidentally pick the same path and
    // trample each other's content during the write → rename window.
    const temporaryPath = `${this.cachePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(
        temporaryPath,
        stringifyJsonBounded(this.entries, MAX_CAPABILITY_CACHE_BYTES, "capability cache"),
        "utf-8",
      );
      await fs.rename(temporaryPath, this.cachePath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => null);
    }
  }

  async getEntry(provider: string, model: string, sdk: string): Promise<RegistryEntry | undefined> {
    await this.loadCache();
    return this.entries.find((e) => e.provider === provider && e.model === model && e.sdk === sdk);
  }

  async upsertEntry(entry: RegistryEntry): Promise<void> {
    await this.loadCache();
    const idx = this.entries.findIndex(
      (e) => e.provider === entry.provider && e.model === entry.model && e.sdk === entry.sdk,
    );
    if (idx >= 0) {
      this.entries[idx] = entry;
    } else {
      this.entries.push(entry);
    }
    await this.saveCache(this.entries);
  }

  async invalidate(provider: string, model: string, sdk: string): Promise<void> {
    await this.loadCache();
    this.entries = this.entries.filter(
      (e) => !(e.provider === provider && e.model === model && e.sdk === sdk),
    );
    await this.saveCache(this.entries);
  }
}

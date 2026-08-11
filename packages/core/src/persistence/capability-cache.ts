import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { type RegistryEntry, RegistryEntrySchema } from "../capability/types.js";
import { parseBoundary, parseJsonBoundary } from "../validation.js";

const CapabilityCacheSchema = z.array(RegistryEntrySchema);

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
      const raw = await fs.readFile(this.cachePath, "utf-8");
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
    await fs.writeFile(this.cachePath, JSON.stringify(this.entries, null, 2), "utf-8");
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

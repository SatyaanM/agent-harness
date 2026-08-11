import fs from "node:fs/promises";
import path from "node:path";
import type { RegistryEntry } from "../capability/types.js";

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
      const parsed = JSON.parse(raw);
      this.entries = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.entries = [];
    }
    this.loaded = true;
    return this.entries;
  }

  async saveCache(entries: RegistryEntry[]): Promise<void> {
    this.entries = entries;
    this.loaded = true;
    const dir = path.dirname(this.cachePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.cachePath, JSON.stringify(entries, null, 2), "utf-8");
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

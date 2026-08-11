import fs from "node:fs";
import path from "node:path";
import {
  type PluginManifest,
  PluginManifestSchema,
  parseJsonBoundary,
  readUtf8FileBoundedSync,
  stringifyJsonBounded,
} from "@agent-harness/core";
import { z } from "zod";

const PluginStateSchema = z
  .object({ enabled: z.record(z.boolean()).refine((value) => Object.keys(value).length <= 10_000) })
  .strict();
const MAX_PLUGIN_MANIFESTS = 1_000;
const MAX_PLUGIN_ENTRIES = 10_000;
const MAX_MANIFEST_BYTES = 1_000_000;
const MAX_PLUGIN_STATE_BYTES = 1_000_000;

function findManifestFiles(dir: string): string[] {
  const results: string[] = [];
  const pending = [dir];
  let visitedEntries = 0;
  while (pending.length > 0 && visitedEntries < MAX_PLUGIN_ENTRIES) {
    const current = pending.pop();
    if (!current) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visitedEntries += 1;
      if (visitedEntries > MAX_PLUGIN_ENTRIES) break;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile() && entry.name === "manifest.json") results.push(full);
      if (results.length >= MAX_PLUGIN_MANIFESTS) return results;
    }
  }
  return results;
}

export function discoverPlugins(pluginsDir: string): PluginManifest[] {
  if (!fs.existsSync(pluginsDir)) {
    return [];
  }

  const manifests = findManifestFiles(pluginsDir);
  const plugins: PluginManifest[] = [];

  for (const file of manifests) {
    try {
      if (fs.statSync(file).size > MAX_MANIFEST_BYTES) continue;
      const parsed = parseJsonBoundary(
        PluginManifestSchema,
        readUtf8FileBoundedSync(file, MAX_MANIFEST_BYTES, `plugin manifest ${file}`),
        `plugin manifest ${file}`,
      );
      plugins.push(parsed);
    } catch (err) {
      console.error(`[plugins] Failed to load manifest ${file}:`, err);
    }
  }

  return plugins;
}

export interface PluginEntry extends PluginManifest {
  enabled: boolean;
}

export class PluginRegistry {
  private stateFile: string;
  private enabled: Record<string, boolean> = {};

  constructor(
    private pluginsDir: string,
    harnessRoot: string,
  ) {
    this.stateFile = path.join(harnessRoot, ".harness", "plugins-state.json");
    this.loadState();
  }

  list(): PluginEntry[] {
    return discoverPlugins(this.pluginsDir).map((plugin) => ({
      ...plugin,
      enabled: this.enabled[plugin.name] ?? true,
    }));
  }

  get(name: string): PluginEntry | undefined {
    return this.list().find((p) => p.name === name);
  }

  setEnabled(name: string, enabled: boolean): PluginEntry | undefined {
    const plugin = this.get(name);
    if (!plugin) return undefined;
    const previous = this.enabled[name];
    this.enabled[name] = enabled;
    try {
      this.saveState();
    } catch (error) {
      if (previous === undefined) delete this.enabled[name];
      else this.enabled[name] = previous;
      throw error;
    }
    return { ...plugin, enabled };
  }

  private loadState(): void {
    if (fs.existsSync(this.stateFile)) {
      this.enabled = parseJsonBoundary(
        PluginStateSchema,
        readUtf8FileBoundedSync(this.stateFile, MAX_PLUGIN_STATE_BYTES, "plugin enabled state"),
        "plugin enabled state",
      ).enabled;
    }
  }

  private saveState(): void {
    const temporaryFile = `${this.stateFile}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      fs.writeFileSync(
        temporaryFile,
        stringifyJsonBounded(
          { enabled: this.enabled },
          MAX_PLUGIN_STATE_BYTES,
          "plugin enabled state",
        ),
        "utf-8",
      );
      fs.renameSync(temporaryFile, this.stateFile);
    } catch (error) {
      try {
        fs.rmSync(temporaryFile, { force: true });
      } catch {}
      throw error;
    }
  }
}

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  BoundaryValidationError,
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

  const manifests = findManifestFiles(pluginsDir).sort();
  const plugins = new Map<string, PluginManifest>();

  for (const file of manifests) {
    try {
      if (fs.statSync(file).size > MAX_MANIFEST_BYTES) continue;
      const parsed = parseJsonBoundary(
        PluginManifestSchema,
        readUtf8FileBoundedSync(file, MAX_MANIFEST_BYTES, `plugin manifest ${file}`),
        `plugin manifest ${file}`,
      );
      if (plugins.has(parsed.name)) {
        console.error(`[plugins] Duplicate plugin name "${parsed.name}" in ${file}; ignoring it`);
        continue;
      }
      plugins.set(parsed.name, parsed);
    } catch (err) {
      console.error(`[plugins] Failed to load manifest ${file}:`, err);
    }
  }

  return [...plugins.values()];
}

export interface PluginEntry extends PluginManifest {
  enabled: boolean;
}

export class PluginRegistry {
  private stateFile: string;
  private enabled = new Map<string, boolean>();
  private invalidState = false;

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
      enabled: this.enabled.get(plugin.name) ?? true,
    }));
  }

  get(name: string): PluginEntry | undefined {
    return this.list().find((p) => p.name === name);
  }

  setEnabled(name: string, enabled: boolean): PluginEntry | undefined {
    const plugin = this.get(name);
    if (!plugin) return undefined;
    const previous = this.enabled.get(name);
    this.enabled.set(name, enabled);
    try {
      this.saveState();
    } catch (error) {
      if (previous === undefined) this.enabled.delete(name);
      else this.enabled.set(name, previous);
      throw error;
    }
    return { ...plugin, enabled };
  }

  private loadState(): void {
    if (fs.existsSync(this.stateFile)) {
      try {
        const parsed = parseJsonBoundary(
          PluginStateSchema,
          readUtf8FileBoundedSync(this.stateFile, MAX_PLUGIN_STATE_BYTES, "plugin enabled state"),
          "plugin enabled state",
        );
        this.enabled = new Map(Object.entries(parsed.enabled));
      } catch (error) {
        if (!(error instanceof BoundaryValidationError)) throw error;
        this.invalidState = true;
        console.error("[plugins] Enabled state is invalid; defaults remain active until repair");
      }
    }
  }

  private saveState(): void {
    const temporaryFile = `${this.stateFile}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      if (this.invalidState && fs.existsSync(this.stateFile)) {
        fs.renameSync(this.stateFile, `${this.stateFile}.invalid-${Date.now()}-${randomUUID()}`);
        this.invalidState = false;
      }
      fs.writeFileSync(
        temporaryFile,
        stringifyJsonBounded(
          { enabled: Object.fromEntries(this.enabled) },
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

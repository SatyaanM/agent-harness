import fs from "node:fs";
import path from "node:path";
import { type PluginManifest, PluginManifestSchema } from "@agent-harness/core";

function findManifestFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findManifestFiles(full));
    } else if (entry.isFile() && entry.name === "manifest.json") {
      results.push(full);
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
      const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
      const parsed = PluginManifestSchema.parse(raw);
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
    this.enabled[name] = enabled;
    this.saveState();
    return this.get(name);
  }

  private loadState(): void {
    try {
      if (fs.existsSync(this.stateFile)) {
        const raw = JSON.parse(fs.readFileSync(this.stateFile, "utf-8"));
        this.enabled = (raw as { enabled?: Record<string, boolean> }).enabled ?? {};
      }
    } catch (err) {
      console.error("[plugins] Failed to load state:", err);
    }
  }

  private saveState(): void {
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      fs.writeFileSync(this.stateFile, JSON.stringify({ enabled: this.enabled }, null, 2), "utf-8");
    } catch (err) {
      console.error("[plugins] Failed to save state:", err);
    }
  }
}

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PluginRegistry } from "./registry.js";

const tempRoots: string[] = [];

async function fixture(name = "example"): Promise<{ pluginsDir: string; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "agent-harness-plugin-registry-"));
  tempRoots.push(root);
  const pluginsDir = path.join(root, "plugins");
  const pluginDir = path.join(pluginsDir, name);
  await mkdir(pluginDir, { recursive: true });
  await writeFile(
    path.join(pluginDir, "manifest.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      provides: { commands: [] },
    }),
  );
  return { pluginsDir, root };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("PluginRegistry", () => {
  it("does not persist state for a plugin that does not exist", async () => {
    const { pluginsDir, root } = await fixture();
    const registry = new PluginRegistry(pluginsDir, root);

    expect(registry.setEnabled("missing", false)).toBeUndefined();
    await expect(access(path.join(root, ".harness", "plugins-state.json"))).rejects.toThrow();
  });

  it("atomically persists validated enabled state", async () => {
    const { pluginsDir, root } = await fixture();
    const registry = new PluginRegistry(pluginsDir, root);

    expect(registry.setEnabled("example", false)?.enabled).toBe(false);

    const stateFile = path.join(root, ".harness", "plugins-state.json");
    await expect(readFile(stateFile, "utf8")).resolves.toContain('"example": false');
    expect(new PluginRegistry(pluginsDir, root).get("example")?.enabled).toBe(false);
  });

  it("treats prototype-shaped plugin names as ordinary state keys", async () => {
    const { pluginsDir, root } = await fixture("constructor");
    const registry = new PluginRegistry(pluginsDir, root);

    expect(registry.get("constructor")?.enabled).toBe(true);
    expect(registry.setEnabled("constructor", false)?.enabled).toBe(false);
    expect(new PluginRegistry(pluginsDir, root).get("constructor")?.enabled).toBe(false);
  });

  it("keeps plugins usable with invalid state and quarantines it on explicit repair", async () => {
    const { pluginsDir, root } = await fixture();
    const harnessDir = path.join(root, ".harness");
    await mkdir(harnessDir, { recursive: true });
    const stateFile = path.join(harnessDir, "plugins-state.json");
    await writeFile(stateFile, "{invalid-json}", "utf8");

    const registry = new PluginRegistry(pluginsDir, root);

    expect(registry.get("example")?.enabled).toBe(true);
    await expect(readFile(stateFile, "utf8")).resolves.toBe("{invalid-json}");
    expect(registry.setEnabled("example", false)?.enabled).toBe(false);
    const files = await import("node:fs/promises").then((fs) => fs.readdir(harnessDir));
    const quarantine = files.find((file) => file.startsWith("plugins-state.json.invalid-"));
    expect(quarantine).toBeDefined();
    if (!quarantine) throw new Error("Expected invalid plugin state quarantine");
    await expect(readFile(path.join(harnessDir, quarantine), "utf8")).resolves.toBe(
      "{invalid-json}",
    );
    expect(new PluginRegistry(pluginsDir, root).get("example")?.enabled).toBe(false);
  });

  it("deduplicates plugin names deterministically", async () => {
    const { pluginsDir, root } = await fixture("duplicate");
    const second = path.join(pluginsDir, "z-second");
    await mkdir(second, { recursive: true });
    await writeFile(
      path.join(second, "manifest.json"),
      JSON.stringify({
        name: "duplicate",
        version: "2.0.0",
        provides: { commands: [] },
      }),
    );

    const entries = new PluginRegistry(pluginsDir, root).list();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.version).toBe("1.0.0");
  });
});

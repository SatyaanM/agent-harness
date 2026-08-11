import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PluginRegistry } from "./registry.js";

const tempRoots: string[] = [];

async function fixture(): Promise<{ pluginsDir: string; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "agent-harness-plugin-registry-"));
  tempRoots.push(root);
  const pluginsDir = path.join(root, "plugins");
  const pluginDir = path.join(pluginsDir, "example");
  await mkdir(pluginDir, { recursive: true });
  await writeFile(
    path.join(pluginDir, "manifest.json"),
    JSON.stringify({
      name: "example",
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
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAgentConfig } from "./config-loader.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("loadAgentConfig", () => {
  it("loads a validated per-agent provider override from frontmatter", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agent-provider-"));
    tempDirs.push(dir);
    const file = path.join(dir, "routed.md");
    await writeFile(
      file,
      [
        "---",
        "name: routed",
        "model: shared-model",
        "provider: preferred-provider",
        "tools: []",
        "maxSteps: 1",
        "---",
        "Use the configured provider.",
      ].join("\n"),
    );

    expect(loadAgentConfig(file)).toEqual(
      expect.objectContaining({ provider: "preferred-provider", model: "shared-model" }),
    );
  });
});

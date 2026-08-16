import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetConfig } from "../config.js";
import { globTool } from "./glob.js";

const originalRoot = process.env.ROOT;
const tempDirs: string[] = [];

async function makeFixture(): Promise<{ root: string; outside: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "agent-harness-glob-policy-"));
  tempDirs.push(base);
  const root = path.join(base, "root");
  const outside = path.join(base, "outside");
  await Promise.all([mkdir(root), mkdir(outside)]);
  process.env.ROOT = root;
  resetConfig();
  return { root, outside };
}

afterEach(async () => {
  resetConfig();
  if (originalRoot === undefined) delete process.env.ROOT;
  else process.env.ROOT = originalRoot;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("glob workspace containment", () => {
  it("rejects absolute and parent-traversing patterns before traversal", async () => {
    const { outside } = await makeFixture();
    const absolutePattern = path.join(outside, "*").replaceAll("\\", "/");

    expect(globTool.parameters.safeParse({ pattern: absolutePattern }).success).toBe(false);
    expect(globTool.parameters.safeParse({ pattern: "../outside/*" }).success).toBe(false);
    expect(globTool.parameters.safeParse({ pattern: `{${absolutePattern},src/*}` }).success).toBe(
      false,
    );
    expect(globTool.parameters.safeParse({ pattern: "{../outside,src}/*" }).success).toBe(false);
  });

  it("re-authorizes matches when a trusted caller bypasses boundary parsing", async () => {
    const { outside } = await makeFixture();
    await writeFile(path.join(outside, "secret.txt"), "secret");
    const absolutePattern = path.join(outside, "*.txt").replaceAll("\\", "/");

    await expect(globTool.execute({ pattern: absolutePattern })).rejects.toThrow(
      "outside the allowed root",
    );
  });
});

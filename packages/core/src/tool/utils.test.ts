import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertCreatablePathWithinRoot,
  assertExistingPathWithinRoot,
  assertWithinRoot,
} from "./utils.js";

const tempDirs: string[] = [];

async function makeFixture(): Promise<{ root: string; outside: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "agent-harness-path-policy-"));
  tempDirs.push(base);
  const root = path.join(base, "root");
  const outside = path.join(base, "outside");
  await Promise.all([mkdir(root), mkdir(outside)]);
  return { root, outside };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("filesystem containment", () => {
  it("rejects lexical traversal outside the authorized root", () => {
    const root = path.resolve("workspace");

    expect(() => assertWithinRoot(path.join(root, "..", "secret.txt"), root)).toThrow(
      "outside the allowed root",
    );
  });

  it("allows a new path whose nearest existing ancestor is inside the root", async () => {
    const { root } = await makeFixture();

    await expect(
      assertCreatablePathWithinRoot(path.join(root, "new", "nested", "file.txt"), root),
    ).resolves.toBeUndefined();
  });

  it("rejects existing and new paths that escape through a directory symlink", async () => {
    const { root, outside } = await makeFixture();
    await writeFile(path.join(outside, "secret.txt"), "secret");
    const link = path.join(root, "link");
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");

    await expect(assertExistingPathWithinRoot(path.join(link, "secret.txt"), root)).rejects.toThrow(
      "outside the allowed root",
    );
    await expect(assertCreatablePathWithinRoot(path.join(link, "new.txt"), root)).rejects.toThrow(
      "outside the allowed root",
    );
  });

  it("rejects a dangling symlink instead of treating it as a creatable path", async () => {
    const { root, outside } = await makeFixture();
    const missingTarget = path.join(outside, "missing");
    const link = path.join(root, "dangling");
    await symlink(missingTarget, link, process.platform === "win32" ? "junction" : "dir");

    await expect(assertCreatablePathWithinRoot(path.join(link, "new.txt"), root)).rejects.toThrow();
  });
});

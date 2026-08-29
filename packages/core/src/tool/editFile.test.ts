import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditFileTool } from "./editFile.js";

const tempDirs: string[] = [];

async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-harness-editfile-"));
  tempDirs.push(root);
  return { root, tool: createEditFileTool(root) };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("editFile tool", () => {
  it("preserves replacement text containing dollar signs and special replacement patterns", async () => {
    const { root, tool } = await makeFixture();
    const filePath = path.join(root, "script.sh");
    await writeFile(filePath, 'echo "OLD_VALUE"\n', "utf8");

    const result = await tool.execute({
      path: "script.sh",
      oldText: 'echo "OLD_VALUE"',
      newText: 'echo "$PATH" && price="$$50" && text="$& $1"',
    });

    expect(result).toContain("Successfully edited script.sh");
    const updated = await readFile(filePath, "utf8");
    expect(updated).toBe('echo "$PATH" && price="$$50" && text="$& $1"\n');
  });

  it("returns an error if the old text is not found", async () => {
    const { root, tool } = await makeFixture();
    const filePath = path.join(root, "hello.txt");
    await writeFile(filePath, "hello world\n", "utf8");

    const result = await tool.execute({
      path: "hello.txt",
      oldText: "missing text",
      newText: "replacement",
    });

    expect(result).toContain("Error: oldText not found");
  });

  it("returns an error if the file does not exist", async () => {
    const { tool } = await makeFixture();
    const result = await tool.execute({
      path: "nonexistent.txt",
      oldText: "a",
      newText: "b",
    });

    expect(result).toContain("Error: File not found");
  });

  it("rejects a directory symlink whose target is outside the workspace", async () => {
    const { root, tool } = await makeFixture();
    const outside = await mkdtemp(path.join(tmpdir(), "agent-harness-editfile-outside-"));
    tempDirs.push(outside);
    const outsideFile = path.join(outside, "secret.txt");
    await writeFile(outsideFile, "secret value\n", "utf8");
    await symlink(
      outside,
      path.join(root, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      tool.execute({ path: "linked/secret.txt", oldText: "secret", newText: "changed" }),
    ).rejects.toThrow("outside the allowed root");
    await expect(readFile(outsideFile, "utf8")).resolves.toBe("secret value\n");
  });

  it("preserves edits through an in-workspace directory symlink", async () => {
    const { root, tool } = await makeFixture();
    const target = path.join(root, "target");
    await mkdir(target);
    await writeFile(path.join(target, "note.txt"), "before\n", "utf8");
    await symlink(
      target,
      path.join(root, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      tool.execute({ path: "linked/note.txt", oldText: "before", newText: "after" }),
    ).resolves.toContain("Successfully edited");
    await expect(readFile(path.join(target, "note.txt"), "utf8")).resolves.toBe("after\n");
  });

  it("rejects a path retargeted after its file handle is opened", async () => {
    const { root, tool } = await makeFixture();
    const first = path.join(root, "first");
    const second = path.join(root, "second");
    const link = path.join(root, "current");
    await Promise.all([mkdir(first), mkdir(second)]);
    await Promise.all([
      writeFile(path.join(first, "note.txt"), "first value\n", "utf8"),
      writeFile(path.join(second, "note.txt"), "second value\n", "utf8"),
    ]);
    await symlink(first, link, process.platform === "win32" ? "junction" : "dir");

    const open = fs.promises.open.bind(fs.promises);
    vi.spyOn(fs.promises, "open").mockImplementationOnce(async (filePath, flags, mode) => {
      const handle = await open(filePath, flags, mode);
      await rm(link);
      await symlink(second, link, process.platform === "win32" ? "junction" : "dir");
      return handle;
    });

    await expect(
      tool.execute({ path: "current/note.txt", oldText: "value", newText: "changed" }),
    ).rejects.toThrow("changed while it was being edited");
    await expect(readFile(path.join(first, "note.txt"), "utf8")).resolves.toBe("first value\n");
    await expect(readFile(path.join(second, "note.txt"), "utf8")).resolves.toBe("second value\n");
  });
});

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openAuthorizedExistingFile,
  overwriteAuthorizedFile,
  readAuthorizedFileBounded,
} from "./authorized-file.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeFixture(): Promise<{
  root: string;
  first: string;
  second: string;
  link: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "agent-harness-authorized-file-"));
  tempDirs.push(root);
  const first = path.join(root, "first");
  const second = path.join(root, "second");
  const link = path.join(root, "current");
  await Promise.all([mkdir(first), mkdir(second)]);
  await Promise.all([
    writeFile(path.join(first, "note.txt"), "first\n", "utf8"),
    writeFile(path.join(second, "note.txt"), "second\n", "utf8"),
  ]);
  await symlink(first, link, process.platform === "win32" ? "junction" : "dir");
  return { root, first, second, link };
}

describe("authorized route files", () => {
  it("reads bounded content through the authorized handle", async () => {
    const { root, first } = await makeFixture();
    const opened = await openAuthorizedExistingFile(path.join(first, "note.txt"), root, "r");
    try {
      await expect(readAuthorizedFileBounded(opened.handle, 10, "route file")).resolves.toEqual(
        Buffer.from("first\n"),
      );
    } finally {
      await opened.handle.close();
    }
  });

  it("rejects a path retargeted after open without changing either file", async () => {
    const { root, first, second, link } = await makeFixture();
    const open = fs.promises.open.bind(fs.promises);
    vi.spyOn(fs.promises, "open").mockImplementationOnce(async (filePath, flags, mode) => {
      const handle = await open(filePath, flags, mode);
      await rm(link);
      await symlink(second, link, process.platform === "win32" ? "junction" : "dir");
      return handle;
    });

    await expect(
      openAuthorizedExistingFile(path.join(link, "note.txt"), root, "r+"),
    ).rejects.toThrow("not a stable authorized file");
    await expect(readFile(path.join(first, "note.txt"), "utf8")).resolves.toBe("first\n");
    await expect(readFile(path.join(second, "note.txt"), "utf8")).resolves.toBe("second\n");
  });

  it("rejects retargeting immediately before a write", async () => {
    const { root, first, second, link } = await makeFixture();
    const opened = await openAuthorizedExistingFile(path.join(link, "note.txt"), root, "r+");
    await rm(link);
    await symlink(second, link, process.platform === "win32" ? "junction" : "dir");
    try {
      await expect(
        overwriteAuthorizedFile(opened.handle, path.join(link, "note.txt"), root, "changed\n"),
      ).rejects.toThrow("not a stable authorized file");
    } finally {
      await opened.handle.close();
    }
    await expect(readFile(path.join(first, "note.txt"), "utf8")).resolves.toBe("first\n");
    await expect(readFile(path.join(second, "note.txt"), "utf8")).resolves.toBe("second\n");
  });
});

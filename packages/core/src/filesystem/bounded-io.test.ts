import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readFileBounded,
  readUtf8FileBounded,
  readUtf8FileBoundedSync,
  stringifyJsonBounded,
} from "./bounded-io.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("bounded file I/O", () => {
  it("rejects oversized asynchronous and synchronous reads", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-bounded-io-"));
    tempRoots.push(root);
    const file = path.join(root, "large.txt");
    await writeFile(file, "x".repeat(11));

    await expect(readFileBounded(file, 10, "test file")).rejects.toThrow("exceeds 10 bytes");
    await expect(readUtf8FileBounded(file, 10, "test file")).rejects.toThrow("exceeds 10 bytes");
    expect(() => readUtf8FileBoundedSync(file, 10, "test file")).toThrow("exceeds 10 bytes");
  });

  it("returns bounded binary content without UTF-8 conversion", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-bounded-io-"));
    tempRoots.push(root);
    const file = path.join(root, "binary.dat");
    await writeFile(file, Buffer.from([0, 255, 1]));

    await expect(readFileBounded(file, 3, "binary file")).resolves.toEqual(
      Buffer.from([0, 255, 1]),
    );
  });

  it("uses the opened descriptor for synchronous size validation and reading", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-bounded-io-"));
    tempRoots.push(root);
    const file = path.join(root, "stable.txt");
    await writeFile(file, "stable");
    const statSync = vi.spyOn(fs, "statSync");
    const readFileSync = vi.spyOn(fs, "readFileSync");

    expect(readUtf8FileBoundedSync(file, 6, "stable file")).toBe("stable");
    expect(statSync).not.toHaveBeenCalled();
    expect(readFileSync).toHaveBeenCalledWith(expect.any(Number), "utf8");
  });

  it("rejects oversized serialized JSON", () => {
    expect(() => stringifyJsonBounded({ value: "too large" }, 10, "test JSON")).toThrow(
      "serialized data exceeds 10 bytes",
    );
  });
});

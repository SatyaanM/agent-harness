import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetConfig } from "@agent-harness/core";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";

const tempDirs: string[] = [];
const originalEnvironment = {
  ROOT: process.env.ROOT,
  INBOX_ROOT: process.env.INBOX_ROOT,
  SESSIONS_DIR: process.env.SESSIONS_DIR,
  AGENTS_DIR: process.env.AGENTS_DIR,
};

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-harness-inbox-route-"));
  tempDirs.push(root);
  process.env.ROOT = root;
  process.env.INBOX_ROOT = path.join(root, "inbox");
  process.env.SESSIONS_DIR = path.join(root, "sessions");
  process.env.AGENTS_DIR = path.join(root, "agents");
  await mkdir(process.env.INBOX_ROOT, { recursive: true });
  resetConfig();
});

afterEach(async () => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfig();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("inbox filesystem boundary", () => {
  it("rejects reads that escape through a directory symlink", async () => {
    const root = process.env.ROOT;
    const inboxRoot = process.env.INBOX_ROOT;
    if (!root || !inboxRoot) throw new Error("Test environment is not initialized");
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await symlink(
      outside,
      path.join(inboxRoot, "link"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const response = await request(createApp()).get("/api/inbox/file").query({
      path: "link/secret.txt",
    });

    expect(response.status).toBe(403);
    expect(response.text).not.toContain("secret");
  });

  it("rejects oversized reads before loading the file into memory", async () => {
    const inboxRoot = process.env.INBOX_ROOT;
    if (!inboxRoot) throw new Error("Test environment is not initialized");
    await writeFile(path.join(inboxRoot, "large.txt"), Buffer.alloc(10_000_001));

    const response = await request(createApp()).get("/api/inbox/file").query({
      path: "large.txt",
    });

    expect(response.status).toBe(413);
  });

  it("uses the inbox envelope limit instead of the smaller global JSON limit", async () => {
    const inboxRoot = process.env.INBOX_ROOT;
    if (!inboxRoot) throw new Error("Test environment is not initialized");
    await writeFile(path.join(inboxRoot, "escaped.txt"), "initial", "utf8");
    const content = "\u0000".repeat(500);

    const response = await request(createApp({ jsonLimit: "1kb", inboxJsonLimit: "4kb" }))
      .put("/api/inbox/file")
      .query({ path: "escaped.txt" })
      .send({ content });

    expect(response.status).toBe(200);
  });
});

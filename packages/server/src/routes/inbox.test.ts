import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetConfig } from "@agent-harness/core";
import fs from "fs-extra";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { RATE_LIMIT_POLICIES } from "../http/rate-limit.js";

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
  vi.restoreAllMocks();
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfig();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("inbox filesystem boundary", () => {
  it("rate-limits repeated malformed requests before inbox body parsing", async () => {
    const app = createApp();
    const first = await request(app)
      .put("/api/inbox/file?path=missing.txt")
      .set("Content-Type", "application/json")
      .send('{"content":');

    expect(first.status).toBe(400);
    expect(first.body).toEqual({
      error: { code: "invalid_json", message: "Request body contains malformed JSON" },
    });

    let exhausted = first;
    for (let index = 1; index <= RATE_LIMIT_POLICIES.requestEnvelope.limit; index += 1) {
      exhausted = await request(app)
        .put("/api/inbox/file?path=missing.txt")
        .set("Content-Type", "application/json")
        .send('{"content":');
    }
    expect(exhausted.status).toBe(429);
    expect(exhausted.body).toEqual({
      error: { code: "rate_limited", message: "Too many requests; retry later" },
    });
  });

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

  it("rejects a read retargeted after its file handle is opened", async () => {
    const inboxRoot = process.env.INBOX_ROOT;
    if (!inboxRoot) throw new Error("Test environment is not initialized");
    const first = path.join(inboxRoot, "first");
    const second = path.join(inboxRoot, "second");
    const link = path.join(inboxRoot, "current");
    await Promise.all([mkdir(first), mkdir(second)]);
    await Promise.all([
      writeFile(path.join(first, "note.txt"), "first secret\n", "utf8"),
      writeFile(path.join(second, "note.txt"), "second secret\n", "utf8"),
    ]);
    await symlink(first, link, process.platform === "win32" ? "junction" : "dir");
    const open = fs.promises.open.bind(fs.promises);
    vi.spyOn(fs.promises, "open").mockImplementationOnce(async (filePath, flags, mode) => {
      const handle = await open(filePath, flags, mode);
      await rm(link);
      await symlink(second, link, process.platform === "win32" ? "junction" : "dir");
      return handle;
    });

    const response = await request(createApp()).get("/api/inbox/file").query({
      path: "current/note.txt",
    });

    expect(response.status).toBe(403);
    expect(response.text).not.toContain("secret");
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

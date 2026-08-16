import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetConfig, SessionStore } from "@agent-harness/core";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { hooks } from "../hooks.js";
import { sessionManager } from "../session-manager.js";

const tempDirs: string[] = [];
const originalRoot = process.env.ROOT;

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-harness-session-routes-"));
  tempDirs.push(root);
  process.env.ROOT = root;
  resetConfig();
  vi.restoreAllMocks();
  return { app: createApp(), root, store: new SessionStore(path.join(root, "sessions")) };
}

afterEach(async () => {
  if (originalRoot === undefined) delete process.env.ROOT;
  else process.env.ROOT = originalRoot;
  resetConfig();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("session collection and durable diagnostics", () => {
  it("returns bounded metadata from the collection endpoint and diagnoses invalid records", async () => {
    const { app, root, store } = await fixture();
    await store.save({
      sessionId: "healthy",
      taskId: "task-1",
      prompt: "hello",
      messages: [{ role: "user", content: "hello" }],
      createdAt: "2026-08-15T00:00:00.000Z",
    });
    const invalidPath = path.join(root, "sessions", "broken.json");
    await writeFile(invalidPath, "{invalid-json}", "utf8");

    const sessions = await request(app).get("/api/sessions");
    const diagnostics = await request(app).get("/api/sessions/diagnostics");

    expect(sessions.status).toBe(200);
    expect(sessions.body).toEqual([
      expect.objectContaining({ sessionId: "healthy", messageCount: 1 }),
    ]);
    expect(sessions.body[0]).not.toHaveProperty("messages");
    expect(diagnostics.status).toBe(200);
    expect(diagnostics.body).toEqual([
      expect.objectContaining({ kind: "transcript", record: "broken.json" }),
    ]);
    await expect(readFile(invalidPath, "utf8")).resolves.toBe("{invalid-json}");
  });

  it("quarantines invalid open-session bytes when a valid update repairs them", async () => {
    const { app, root } = await fixture();
    const harnessDir = path.join(root, ".harness");
    await mkdir(harnessDir, { recursive: true });
    const stateFile = path.join(harnessDir, "open-sessions.json");
    await writeFile(stateFile, "{invalid-json}", "utf8");

    const repaired = await request(app)
      .put("/api/sessions/open")
      .send({
        activeSessionId: "healthy",
        openSessionIds: ["healthy"],
      });

    expect(repaired.status).toBe(200);
    expect(repaired.body).toEqual({ activeSessionId: "healthy", openSessionIds: ["healthy"] });
    const files = await readdir(harnessDir);
    const quarantine = files.find((file) => file.startsWith("open-sessions.json.invalid-"));
    expect(quarantine).toBeDefined();
    if (!quarantine) throw new Error("Expected quarantined open-session state");
    await expect(readFile(path.join(harnessDir, quarantine), "utf8")).resolves.toBe(
      "{invalid-json}",
    );
  });

  it("preserves the active session when a partial open-set update omits it", async () => {
    const { app } = await fixture();
    await request(app)
      .put("/api/sessions/open")
      .send({
        activeSessionId: "one",
        openSessionIds: ["one"],
      });

    const updated = await request(app)
      .put("/api/sessions/open")
      .send({ openSessionIds: ["one", "two"] });

    expect(updated.body).toEqual({ activeSessionId: "one", openSessionIds: ["one", "two"] });
  });

  it("rejects duplicate or inactive open-session projections", async () => {
    const { app } = await fixture();

    const duplicate = await request(app)
      .put("/api/sessions/open")
      .send({ activeSessionId: "one", openSessionIds: ["one", "one"] });
    const missingActive = await request(app)
      .put("/api/sessions/open")
      .send({ activeSessionId: "missing", openSessionIds: ["one"] });

    expect(duplicate.status).toBe(400);
    expect(missingActive.status).toBe(400);
  });

  it("runs close middleware before commit and unloads only after it passes", async () => {
    const { app } = await fixture();
    await request(app)
      .put("/api/sessions/open")
      .send({ activeSessionId: "one", openSessionIds: ["one"] });
    const before = vi.spyOn(hooks, "runBefore").mockRejectedValueOnce(new Error("veto"));
    const unload = vi.spyOn(sessionManager, "unload");

    const vetoed = await request(app)
      .put("/api/sessions/open")
      .send({ activeSessionId: null, openSessionIds: [] });

    expect(vetoed.status).toBe(500);
    expect((await request(app).get("/api/sessions/open")).body).toEqual({
      activeSessionId: "one",
      openSessionIds: ["one"],
    });
    expect(unload).not.toHaveBeenCalled();

    before.mockResolvedValueOnce();
    const closed = await request(app)
      .put("/api/sessions/open")
      .send({ activeSessionId: null, openSessionIds: [] });
    expect(closed.status).toBe(200);
    expect(before).toHaveBeenLastCalledWith("session.beforeClose", { sessionId: "one" });
    expect(unload).toHaveBeenCalledWith("one");
  });

  it("vetoes deletion before durable state or runtime lifecycle changes", async () => {
    const { app, store } = await fixture();
    await store.save({
      sessionId: "kept",
      taskId: "task-1",
      prompt: "keep",
      messages: [],
      createdAt: "2026-08-15T00:00:00.000Z",
    });
    vi.spyOn(hooks, "runBefore").mockRejectedValueOnce(new Error("veto"));
    const prepare = vi.spyOn(sessionManager, "prepareSessionDeletion");

    const response = await request(app).delete("/api/sessions/kept");

    expect(response.status).toBe(500);
    await expect(store.load("kept")).resolves.not.toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });
});

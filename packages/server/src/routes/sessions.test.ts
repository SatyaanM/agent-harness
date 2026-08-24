import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createDatabaseConnection,
  createSessionData,
  resetConfig,
  SessionRepository,
  SessionRuntime,
  SessionStore,
  SqliteMigrator,
} from "@agent-harness/core";
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
  await sessionManager.close();
  if (originalRoot === undefined) delete process.env.ROOT;
  else process.env.ROOT = originalRoot;
  resetConfig();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("session collection and durable diagnostics", () => {
  it("returns bounded metadata from the collection endpoint and diagnoses invalid records", async () => {
    const { app, root, store } = await fixture();
    await store.save(
      createSessionData({
        sessionId: "healthy",
        prompt: "hello",
        messages: [{ role: "user", content: "hello" }],
        createdAt: "2026-08-15T00:00:00.000Z",
      }),
    );
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
    await store.save(
      createSessionData({
        sessionId: "kept",
        prompt: "keep",
        createdAt: "2026-08-15T00:00:00.000Z",
      }),
    );
    vi.spyOn(hooks, "runBefore").mockRejectedValueOnce(new Error("veto"));
    const prepare = vi.spyOn(sessionManager, "prepareSessionDeletion");

    const response = await request(app).delete("/api/sessions/kept");

    expect(response.status).toBe(500);
    await expect(store.load("kept")).resolves.not.toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("handles conditional mailbox wake in POST /api/sessions/:id/open", async () => {
    const { app, store } = await fixture();
    const deliverSpy = vi.spyOn(SessionRuntime.prototype, "deliver").mockResolvedValue({
      status: "success",
      summary: "done",
      messages: [],
    });
    await store.save(
      createSessionData({
        sessionId: "with-mailbox",
        prompt: "init",
        createdAt: "2026-08-15T00:00:00.000Z",
      }),
    );
    await store.appendMailbox("with-mailbox", {
      taskId: "w-1",
      from: "worker",
      agentName: "worker",
      status: "done",
      summary: "res",
      receivedAt: "2026-08-15T00:00:00.000Z",
    });
    await store.save(
      createSessionData({
        sessionId: "idle",
        taskId: "task-2",
        prompt: "idle",
        createdAt: "2026-08-15T00:00:00.000Z",
      }),
    );

    const wakeRes = await request(app).post("/api/sessions/with-mailbox/open");
    expect(wakeRes.status).toBe(200);
    expect(wakeRes.body).toEqual({ woke: true, pendingCount: 1 });
    expect(deliverSpy).toHaveBeenCalled();

    const idleRes = await request(app).post("/api/sessions/idle/open");
    expect(idleRes.status).toBe(200);
    expect(idleRes.body).toEqual({ woke: false, pendingCount: 0 });

    const missingRes = await request(app).post("/api/sessions/nonexistent/open");
    expect(missingRes.status).toBe(404);
  });

  it("handles session CRUD endpoints and lifecycle hooks", async () => {
    const { app, store } = await fixture();
    const createdHook = vi.fn();
    const renamedHook = vi.fn();
    const deletedHook = vi.fn();
    hooks.on("session.created", createdHook);
    hooks.on("session.renamed", renamedHook);
    hooks.on("session.deleted", deletedHook);

    // POST /api/sessions
    const createRes = await request(app).post("/api/sessions").send({
      prompt: "New Session",
      agentName: "orchestrator",
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body).toMatchObject({
      prompt: "New Session",
      agentName: "orchestrator",
    });
    const sessionId = createRes.body.sessionId;
    expect(sessionId).toBeDefined();
    expect(createdHook).toHaveBeenCalledWith(expect.objectContaining({ sessionId }));

    // GET /api/sessions/:id
    const getRes = await request(app).get(`/api/sessions/${sessionId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.sessionId).toBe(sessionId);

    const getMissing = await request(app).get("/api/sessions/missing-id");
    expect(getMissing.status).toBe(404);

    // PATCH /api/sessions/:id (renaming)
    const patchRes = await request(app)
      .patch(`/api/sessions/${sessionId}`)
      .send({ title: "  Renamed Title  " });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.title).toBe("Renamed Title");
    expect(renamedHook).toHaveBeenCalledWith({
      sessionId,
      title: "Renamed Title",
    });

    // DELETE /api/sessions/:id
    const deleteRes = await request(app).delete(`/api/sessions/${sessionId}`);
    expect(deleteRes.status).toBe(204);
    expect(deletedHook).toHaveBeenCalledWith({ sessionId });
    await expect(store.load(sessionId)).resolves.toBeNull();
  });

  it("synchronizes SQLite repositories on session creation, rename, open, and deletion", async () => {
    const { app, root } = await fixture();
    const dbPath = path.join(root, "test-routes.db");
    const db = createDatabaseConnection(dbPath);
    new SqliteMigrator(db).up();
    sessionManager.initialize(db);

    try {
      // 1. POST /api/sessions
      const createRes = await request(app).post("/api/sessions").send({
        prompt: "SQLite Session",
        agentName: "orchestrator",
      });
      expect(createRes.status).toBe(201);
      const sessionId = createRes.body.sessionId;

      const sessionRepo = new SessionRepository(db);
      const inDb = sessionRepo.get(sessionId);
      expect(inDb).toBeDefined();
      expect(inDb?.prompt).toBe("SQLite Session");

      // 2. PATCH /api/sessions/:id
      const patchRes = await request(app)
        .patch(`/api/sessions/${sessionId}`)
        .send({ title: "Updated SQLite Title" });
      expect(patchRes.status).toBe(200);

      const afterPatch = sessionRepo.get(sessionId);
      expect(afterPatch?.title).toBe("Updated SQLite Title");

      // 3. DELETE /api/sessions/:id
      const deleteRes = await request(app).delete(`/api/sessions/${sessionId}`);
      expect(deleteRes.status).toBe(204);

      // Verify deleted from SQLite (preventing resurrection)
      expect(sessionRepo.get(sessionId)).toBeUndefined();
    } finally {
      await sessionManager.close();
    }
  });
});

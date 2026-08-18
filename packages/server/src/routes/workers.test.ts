import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetConfig } from "@agent-harness/core";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { sessionManager } from "../session-manager.js";

const tempDirs: string[] = [];
const originalRoot = process.env.ROOT;

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-harness-worker-routes-"));
  tempDirs.push(root);
  process.env.ROOT = root;
  resetConfig();
  vi.restoreAllMocks();
  return { app: createApp(), root };
}

afterEach(async () => {
  if (originalRoot === undefined) delete process.env.ROOT;
  else process.env.ROOT = originalRoot;
  resetConfig();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("worker routes", () => {
  it("cancels an active worker and returns 200 with success: true", async () => {
    const { app } = await fixture();
    const controller = new AbortController();
    sessionManager.trackWorker("task-123", "session-parent", controller);

    expect(controller.signal.aborted).toBe(false);

    const res = await request(app).post("/api/workers/task-123/cancel");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ taskId: "task-123", success: true });
    expect(controller.signal.aborted).toBe(true);
  });

  it("returns 404 for non-existent or settled worker", async () => {
    const { app } = await fixture();
    const res = await request(app).post("/api/workers/nonexistent-task/cancel");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "No running worker found for that task" });
  });
});

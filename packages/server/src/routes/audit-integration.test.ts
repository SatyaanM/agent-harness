import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteDatabaseDriver } from "@agent-harness/core";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { sessionManager } from "../session-manager.js";

describe("Audit Integration in Server Routes", () => {
  let tmpDir: string;
  let db: SqliteDatabaseDriver;
  const app = createApp();

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-server-test-"));
    db = new SqliteDatabaseDriver(path.join(tmpDir, "test.db"));
    await sessionManager.initialize(db);
  });

  afterEach(async () => {
    await sessionManager.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records hash-chained audit events for session lifecycle actions", async () => {
    // 1. Create session
    const createRes = await request(app)
      .post("/api/sessions")
      .send({ prompt: "Audited task", agentName: "orchestrator" });
    expect(createRes.status).toBe(201);
    const sessionId = createRes.body.sessionId;

    // 2. Rename session
    const renameRes = await request(app)
      .patch(`/api/sessions/${sessionId}`)
      .send({ title: "Renamed Title" });
    expect(renameRes.status).toBe(200);

    // 3. Delete session
    const deleteRes = await request(app).delete(`/api/sessions/${sessionId}`);
    expect(deleteRes.status).toBe(204);

    const auditRepo = sessionManager.getAuditRepo();
    expect(auditRepo).toBeDefined();

    const auditList = auditRepo?.list({ limit: 10 });
    expect(auditList?.total).toBe(3);

    const actions = auditList?.events.map((e) => e.action);
    expect(actions).toContain("session.create");
    expect(actions).toContain("session.rename");
    expect(actions).toContain("session.delete");

    // Verify hash chain
    const e1 = auditRepo?.get(1);
    const e2 = auditRepo?.get(2);
    const e3 = auditRepo?.get(3);

    expect(e1?.prev_hash).toBe("0000000000000000000000000000000000000000000000000000000000000000");
    expect(e2?.prev_hash).toBe(e1?.current_hash);
    expect(e3?.prev_hash).toBe(e2?.current_hash);
  });

  it("records audit events for tool executions", async () => {
    sessionManager.audit({
      actorType: "agent",
      actorId: "orchestrator",
      action: "tool.exec.shell",
      resourceType: "tool",
      resourceId: "runCommand",
      payload: { sessionId: "s1", runId: "r1", args: { command: "git status" } },
    });

    sessionManager.audit({
      actorType: "agent",
      actorId: "orchestrator",
      action: "tool.exec.file_write",
      resourceType: "tool",
      resourceId: "writeFile",
      payload: { sessionId: "s1", runId: "r1", args: { path: "hello.txt" } },
    });

    const auditRepo = sessionManager.getAuditRepo();
    const list = auditRepo?.list();
    expect(list?.total).toBe(2);
    expect(list?.events[0]?.action).toBe("tool.exec.file_write");
    expect(list?.events[1]?.action).toBe("tool.exec.shell");
  });
});

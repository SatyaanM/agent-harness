import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDatabaseConnection,
  MailboxRepository,
  SessionRepository,
  SqliteMigrator,
  TaskRepository,
} from "@agent-harness/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionManager } from "../../packages/server/src/session-manager.js";

describe("Chaos Crash Injection & Orphan Task Reconciliation", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-chaos-"));
    dbPath = path.join(tmpDir, "harness.db");
  });

  afterEach(() => {
    sessionManager.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("reconciles in-flight orphaned worker tasks to 'abandoned' following an abrupt server crash", async () => {
    // 1. Initialize SQLite schema in isolated test DB
    const initialDb = createDatabaseConnection(dbPath);
    const migrator = new SqliteMigrator(initialDb);
    migrator.up();

    const sessionRepo = new SessionRepository(initialDb);
    const taskRepo = new TaskRepository(initialDb);

    // 2. Create parent session and in-flight tasks (simulating state before sudden SIGKILL)
    const parentSession = sessionRepo.create({
      id: "parent-session-crashed",
      agentName: "orchestrator",
      prompt: "Simulated pre-crash orchestration prompt",
    });

    const orphanRunningTask = taskRepo.create({
      taskId: "task-orphaned-running",
      parentSessionId: parentSession.id,
      description: "In-flight background task when SIGKILL occurred",
      status: "running",
    });

    const orphanQueuedTask = taskRepo.create({
      taskId: "task-orphaned-queued",
      parentSessionId: parentSession.id,
      description: "Queued background task when SIGKILL occurred",
      status: "queued",
    });

    expect(orphanRunningTask.status).toBe("running");
    expect(orphanQueuedTask.status).toBe("queued");

    // Close initial connection simulating abrupt process death
    initialDb.close();

    // 3. Restart server lifecycle: SessionManager.initialize() against the persisted database
    const recoveredDb = createDatabaseConnection(dbPath);
    await sessionManager.initialize(recoveredDb);

    // 4. Assert that startup reconciliation transitioned all orphaned tasks to 'abandoned'
    const postCrashTaskRepo = new TaskRepository(recoveredDb);
    const reconciledRunning = postCrashTaskRepo.get("task-orphaned-running");
    const reconciledQueued = postCrashTaskRepo.get("task-orphaned-queued");

    expect(reconciledRunning?.status).toBe("abandoned");
    expect(reconciledRunning?.completed_at).toBeDefined();
    expect(reconciledRunning?.error_message).toContain("abandoned");

    expect(reconciledQueued?.status).toBe("abandoned");
    expect(reconciledQueued?.completed_at).toBeDefined();

    // 5. Assert diagnostic mailbox events were enqueued for parent session wake-up
    const postCrashMailboxRepo = new MailboxRepository(recoveredDb);
    const pendingEvents = postCrashMailboxRepo.peekPending(parentSession.id);

    expect(pendingEvents.length).toBe(2);
    expect(pendingEvents.some((e) => e.task_id === "task-orphaned-running")).toBe(true);
    expect(pendingEvents.some((e) => e.task_id === "task-orphaned-queued")).toBe(true);
    expect(pendingEvents[0]?.event_type).toBe("worker_abandoned");
  });
});

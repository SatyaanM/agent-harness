import {
  createDatabaseConnection,
  MailboxRepository,
  SessionRepository,
  SqliteMigrator,
  TaskRepository,
} from "@agent-harness/core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "./session-manager.js";

describe("SessionManager lifecycle ownership", () => {
  it("coalesces concurrent settings reconfiguration callers onto the lifecycle barrier", async () => {
    const manager = new SessionManager();
    const active = new AbortController();
    manager.trackSession("active-session", active);

    const first = manager.reconfigureAfterSettingsUpdate();
    const second = manager.reconfigureAfterSettingsUpdate();
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });

    expect(active.signal.aborted).toBe(true);
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    manager.clearSession("active-session", active);
    await Promise.all([first, second]);
    await expect(manager.reconfigureAfterSettingsUpdate()).resolves.toBeUndefined();
  });

  it("keeps a cancelled worker tracked so settings reconfiguration waits for terminal cleanup", async () => {
    const manager = new SessionManager();
    const worker = new AbortController();
    manager.trackWorker("task-cancelled", "parent", worker);

    expect(manager.cancelWorker("task-cancelled")).toBe(true);
    expect(worker.signal.aborted).toBe(true);
    expect(manager.metrics().activeWorkers).toBe(1);

    let reconfigured = false;
    const reconfiguration = manager.reconfigureAfterSettingsUpdate().then(() => {
      reconfigured = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reconfigured).toBe(false);

    manager.onWorkerSettled("task-cancelled");
    await reconfiguration;
    expect(manager.metrics().activeWorkers).toBe(0);
  });

  it("blocks a replacement runtime until aborted parent and worker work reaches terminal cleanup", async () => {
    const manager = new SessionManager();
    const parent = new AbortController();
    const worker = new AbortController();
    manager.getOrCreate("loaded-session");
    manager.trackSession("loaded-session", parent);
    manager.trackWorker("task-1", "loaded-session", worker);

    const reconfiguration = manager.reconfigureAfterSettingsUpdate();

    expect(parent.signal.aborted).toBe(true);
    expect(worker.signal.aborted).toBe(true);
    expect(() => manager.getOrCreate("loaded-session")).toThrow("reconfiguration is in progress");
    manager.clearSession("loaded-session", parent);
    manager.onWorkerSettled("task-1");
    await reconfiguration;
    expect(manager.isLoaded("loaded-session")).toBe(false);
    expect(manager.metrics().activeWorkers).toBe(0);
  });

  it("unloads a deleted parent, aborts its workers, and rejects late delivery", () => {
    const manager = new SessionManager();
    const controller = new AbortController();
    manager.trackWorker("task-1", "parent", controller);

    manager.prepareSessionDeletion("parent");

    expect(controller.signal.aborted).toBe(true);
    expect(manager.metrics().activeWorkers).toBe(1);
    expect(manager.isSessionAvailable("parent")).toBe(false);
    manager.onWorkerSettled("task-1");
    expect(manager.metrics().activeWorkers).toBe(0);
  });

  it("waits for a deleted parent's aborted worker to reach terminal cleanup before reconfiguration", async () => {
    const manager = new SessionManager();
    const worker = new AbortController();
    manager.trackWorker("task-deleted", "deleted-parent", worker);

    manager.prepareSessionDeletion("deleted-parent");
    expect(worker.signal.aborted).toBe(true);

    let reconfigured = false;
    const reconfiguration = manager.reconfigureAfterSettingsUpdate().then(() => {
      reconfigured = true;
    });
    await Promise.resolve();
    expect(reconfigured).toBe(false);

    manager.onWorkerSettled("task-deleted");
    await reconfiguration;
    expect(reconfigured).toBe(true);
  });

  it("waits for a deleted parent's active run to clear before settings reconfiguration", async () => {
    const manager = new SessionManager();
    const parent = new AbortController();
    manager.trackSession("deleted-parent", parent);

    manager.prepareSessionDeletion("deleted-parent");
    expect(parent.signal.aborted).toBe(true);

    let reconfigured = false;
    const reconfiguration = manager.reconfigureAfterSettingsUpdate().then(() => {
      reconfigured = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reconfigured).toBe(false);

    manager.clearSession("deleted-parent", parent);
    await reconfiguration;
    expect(reconfigured).toBe(true);
  });

  it("cleans a worker controller on every terminal path", () => {
    const manager = new SessionManager();
    manager.trackWorker("task-1", "parent", new AbortController());

    manager.onWorkerSettled("task-1");

    expect(manager.metrics().activeWorkers).toBe(0);
  });

  it("tracks multiple concurrent requests per session and aborts all of them on session deletion", () => {
    const manager = new SessionManager();
    const c1 = new AbortController();
    const c2 = new AbortController();
    manager.trackSession("session-1", c1);
    manager.trackSession("session-1", c2);

    manager.prepareSessionDeletion("session-1");

    expect(c1.signal.aborted).toBe(true);
    expect(c2.signal.aborted).toBe(true);
  });

  it("clearing one completed request leaves other concurrent active requests tracked", () => {
    const manager = new SessionManager();
    const c1 = new AbortController();
    const c2 = new AbortController();
    manager.trackSession("session-1", c1);
    manager.trackSession("session-1", c2);

    manager.clearSession("session-1", c1);
    manager.prepareSessionDeletion("session-1");

    expect(c1.signal.aborted).toBe(false);
    expect(c2.signal.aborted).toBe(true);
  });

  it("bounds deletedSessions set to prevent unbounded memory growth", () => {
    const manager = new SessionManager();
    for (let i = 0; i < 5005; i++) {
      manager.prepareSessionDeletion(`session-${i}`);
    }

    // Earliest deleted sessions should be evicted after exceeding capacity
    expect(manager.isSessionAvailable("session-0")).toBe(true);
    // Recent deleted sessions should remain marked unavailable
    expect(manager.isSessionAvailable("session-5004")).toBe(false);
  });

  it("reconciles orphaned running tasks to abandoned on startup and enqueues diagnostic mailbox event", async () => {
    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();

    const sessionRepo = new SessionRepository(db);
    const taskRepo = new TaskRepository(db);
    const mailboxRepo = new MailboxRepository(db);

    sessionRepo.create({
      id: "parent-reconcile",
      agentName: "orchestrator",
      prompt: "main task",
    });

    sessionRepo.create({
      id: "worker-reconcile",
      agentName: "researcher",
      prompt: "background research",
    });

    taskRepo.create({
      taskId: "task-orphaned-1",
      parentSessionId: "parent-reconcile",
      workerSessionId: "worker-reconcile",
      description: "orphaned background task",
      status: "running",
    });

    const manager = new SessionManager();
    await manager.initialize(db);

    // Verify task status was transitioned to abandoned
    const updatedTask = taskRepo.get("task-orphaned-1");
    expect(updatedTask?.status).toBe("abandoned");
    expect(updatedTask?.error_code).toBe("TASK_ABANDONED_ON_STARTUP");
    expect(updatedTask?.completed_at).toBeDefined();

    // Verify diagnostic mailbox event was enqueued
    const pendingEvents = mailboxRepo.peekPending("parent-reconcile");
    expect(pendingEvents).toHaveLength(1);
    expect(pendingEvents[0]?.task_id).toBe("task-orphaned-1");
    expect(pendingEvents[0]?.event_type).toBe("worker_abandoned");
    expect(pendingEvents[0]?.payload).toContain(
      "Task was abandoned due to an ungraceful server termination",
    );

    db.close();
  });
});

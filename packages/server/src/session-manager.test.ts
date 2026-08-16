import { describe, expect, it } from "vitest";
import { SessionManager } from "./session-manager.js";

describe("SessionManager lifecycle ownership", () => {
  it("unloads a deleted parent, aborts its workers, and rejects late delivery", () => {
    const manager = new SessionManager();
    const controller = new AbortController();
    manager.trackWorker("task-1", "parent", controller);

    manager.prepareSessionDeletion("parent");

    expect(controller.signal.aborted).toBe(true);
    expect(manager.metrics().activeWorkers).toBe(0);
    expect(manager.isSessionAvailable("parent")).toBe(false);
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
});

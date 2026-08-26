import { beforeEach, describe, expect, it } from "vitest";
import { MAX_WORKERS_PER_SESSION, useRosterStore } from "./agent-roster-store";

beforeEach(() => {
  useRosterStore.setState({ bySession: {} });
});

describe("worker roster retention", () => {
  it("bounds workers retained for each session", () => {
    for (let index = 0; index <= MAX_WORKERS_PER_SESSION; index++) {
      useRosterStore.getState().addWorker("session", {
        id: `worker-${index}`,
        name: `Worker ${index}`,
        taskId: `task-${index}`,
        task: "work",
        status: "completed",
      });
    }

    const workers = useRosterStore.getState().bySession.session ?? [];
    expect(workers).toHaveLength(MAX_WORKERS_PER_SESSION);
    expect(workers[0]?.id).toBe("worker-1");
  });

  it("prunes workers omitted from an authoritative hydration snapshot", () => {
    useRosterStore.setState({
      bySession: {
        session: [
          {
            id: "worker-stale",
            name: "Stale worker",
            taskId: "task-stale",
            task: "old work",
            status: "completed",
            createdAt: "2026-08-23T00:00:00.000Z",
            updatedAt: "2026-08-23T00:10:00.000Z",
          },
        ],
      },
    });
    const requestSequence = useRosterStore.getState().beginHydration("session");

    useRosterStore.getState().hydrate("session", [], requestSequence);

    expect(useRosterStore.getState().bySession.session).toEqual([]);
  });

  it("preserves a socket worker newer than the hydration request", () => {
    const requestSequence = useRosterStore.getState().beginHydration("session");
    useRosterStore.getState().addWorker("session", {
      id: "worker-live",
      name: "Live worker",
      taskId: "task-live",
      task: "new work",
      status: "running",
      createdAt: "2026-08-23T01:00:01.000Z",
      updatedAt: "2026-08-23T01:00:01.000Z",
    });

    useRosterStore.getState().hydrate("session", [], requestSequence);

    expect(useRosterStore.getState().bySession.session).toEqual([
      expect.objectContaining({ taskId: "task-live", status: "running" }),
    ]);
  });

  it("does not let a future-dated server snapshot overwrite a later socket completion", () => {
    const requestSequence = useRosterStore.getState().beginHydration("session");
    useRosterStore.getState().addWorker("session", {
      id: "worker-skew",
      name: "Worker",
      taskId: "task-skew",
      task: "work",
      status: "completed",
      updatedAt: "2026-08-23T00:00:00.000Z",
    });

    useRosterStore.getState().hydrate(
      "session",
      [
        {
          taskId: "task-skew",
          workerSessionId: "worker-skew",
          agentName: "Worker",
          description: "work",
          status: "running",
          createdAt: "2026-08-23T02:00:00.000Z",
          updatedAt: "2026-08-23T02:00:00.000Z",
        },
      ],
      requestSequence,
    );

    expect(useRosterStore.getState().bySession.session).toEqual([
      expect.objectContaining({ taskId: "task-skew", status: "completed" }),
    ]);
  });

  it("retains a completion that races the first hydration of an empty roster", () => {
    const requestSequence = useRosterStore.getState().beginHydration("session");
    useRosterStore.getState().setWorkerStatus("session", "task-first", "completed");

    useRosterStore.getState().hydrate(
      "session",
      [
        {
          taskId: "task-first",
          workerSessionId: "worker-task-first",
          agentName: "Worker",
          description: "work",
          status: "running",
          createdAt: "2026-08-23T00:00:00.000Z",
          updatedAt: "2026-08-23T00:00:01.000Z",
        },
      ],
      requestSequence,
    );

    expect(useRosterStore.getState().bySession.session).toEqual([
      expect.objectContaining({
        id: "worker-task-first",
        taskId: "task-first",
        task: "work",
        status: "completed",
      }),
    ]);
  });

  it("hydrates all 64 active workers from the authoritative snapshot", () => {
    const requestSequence = useRosterStore.getState().beginHydration("session");
    const workers = Array.from({ length: 64 }, (_, index) => ({
      taskId: `task-${index}`,
      workerSessionId: `worker-${index}`,
      agentName: `Worker ${index}`,
      description: `work ${index}`,
      status: "running" as const,
      createdAt: new Date(index + 1).toISOString(),
      updatedAt: new Date(index + 1).toISOString(),
    }));

    useRosterStore.getState().hydrate("session", workers, requestSequence);

    expect(useRosterStore.getState().bySession.session).toHaveLength(64);
  });

  it("ignores an older same-session hydration response that arrives last", () => {
    const olderRequest = useRosterStore.getState().beginHydration("session");
    const newerRequest = useRosterStore.getState().beginHydration("session");
    useRosterStore.getState().hydrate(
      "session",
      [
        {
          taskId: "new-worker",
          workerSessionId: "worker-new",
          agentName: "New worker",
          description: "new snapshot",
          status: "running",
          createdAt: "2026-08-24T00:00:00.000Z",
          updatedAt: "2026-08-24T00:00:01.000Z",
        },
      ],
      newerRequest,
    );
    useRosterStore.getState().hydrate(
      "session",
      [
        {
          taskId: "stale-worker",
          workerSessionId: "worker-stale",
          agentName: "Stale worker",
          description: "old snapshot",
          status: "running",
          createdAt: "2026-08-23T00:00:00.000Z",
          updatedAt: "2026-08-23T00:00:01.000Z",
        },
      ],
      olderRequest,
    );

    expect(useRosterStore.getState().bySession.session).toEqual([
      expect.objectContaining({ taskId: "new-worker" }),
    ]);
  });

  it("retains a post-request completion when an authoritative snapshot fills capacity", () => {
    const requestSequence = useRosterStore.getState().beginHydration("session");
    useRosterStore.getState().setWorkerStatus("session", "live-completion", "completed");
    const workers = Array.from({ length: MAX_WORKERS_PER_SESSION }, (_, index) => ({
      taskId: `snapshot-${index}`,
      workerSessionId: `worker-${index}`,
      agentName: `Worker ${index}`,
      description: `work ${index}`,
      status: "running" as const,
      createdAt: new Date(index + 1).toISOString(),
      updatedAt: new Date(index + 1).toISOString(),
    }));

    useRosterStore.getState().hydrate("session", workers, requestSequence);

    const hydrated = useRosterStore.getState().bySession.session ?? [];
    expect(hydrated).toHaveLength(MAX_WORKERS_PER_SESSION);
    expect(hydrated).toContainEqual(expect.objectContaining({ taskId: "live-completion" }));
  });
});

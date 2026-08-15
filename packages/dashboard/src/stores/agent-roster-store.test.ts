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
        status: "done",
      });
    }

    const workers = useRosterStore.getState().bySession.session ?? [];
    expect(workers).toHaveLength(MAX_WORKERS_PER_SESSION);
    expect(workers[0]?.id).toBe("worker-1");
  });
});

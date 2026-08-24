import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { useRosterStore } from "@/stores/agent-roster-store";
import { useRuntimeStore } from "@/stores/runtime-store";
import { useSessionStore } from "@/stores/session-store";
import {
  createTestMessage,
  createTestServerSession,
  createTestSession,
} from "@/test-helpers/session-fixtures";
import RuntimeSync, { resolveRestoredOpenState } from "./RuntimeSync";

const { mockSocket, clearListeners } = vi.hoisted(() => {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const socket = {
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)?.push(callback);
    }),
    off: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      const list = listeners.get(event);
      if (list) {
        listeners.set(
          event,
          list.filter((cb) => cb !== callback),
        );
      }
    }),
    emit: (event: string, ...args: unknown[]) => {
      listeners.get(event)?.forEach((cb) => {
        cb(...args);
      });
    },
  };
  return {
    mockSocket: socket,
    clearListeners: () => listeners.clear(),
  };
});

vi.mock("@/lib/api", () => ({
  fetchOpenSessions: vi.fn(),
  fetchSession: vi.fn(),
  fetchWorkers: vi.fn().mockResolvedValue([]),
  updateOpenSessions: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/ws", () => ({
  connectSocket: vi.fn(() => mockSocket),
  validatedEventHandler: (_schema: unknown, _name: string, handler: (data: unknown) => void) =>
    handler,
  SessionUpdatedEventSchema: {},
  ToolEventSchema: {},
  AgentLifecycleEventSchema: {},
  WorkerSpawnedEventSchema: {},
  WorkerCompletedEventSchema: {},
}));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (!resolvePromise) throw new Error("Deferred promise is not initialized");
      resolvePromise(value);
    },
  };
}

describe("RuntimeSync hydration & open state", () => {
  it("selects active state only from successfully restored sessions", () => {
    expect(
      resolveRestoredOpenState(
        { activeSessionId: "missing", openSessionIds: ["missing", "healthy"] },
        [{ sessionId: "healthy" }],
      ),
    ).toEqual({ activeSessionId: "healthy", openSessionIds: ["healthy"] });
  });

  it("clears active state when no transcript restores", () => {
    expect(
      resolveRestoredOpenState({ activeSessionId: "missing", openSessionIds: ["missing"] }, []),
    ).toEqual({ activeSessionId: null, openSessionIds: [] });
  });
});

describe("RuntimeSync component lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearListeners();
    useSessionStore.setState({ sessions: [], activeSessionId: null });
    useRuntimeStore.setState({ activity: {}, running: {} });
    useRosterStore.setState({ bySession: {} });
    vi.mocked(api.fetchWorkers).mockResolvedValue([]);
  });

  it("hydrates successfully and does not overwrite with empty state on failure", async () => {
    vi.mocked(api.fetchOpenSessions).mockRejectedValueOnce(new Error("network failure"));

    render(<RuntimeSync />);

    await waitFor(() => {
      expect(api.fetchOpenSessions).toHaveBeenCalled();
    });

    expect(api.updateOpenSessions).not.toHaveBeenCalled();
  });

  it("hydrates open sessions and updates repaired state", async () => {
    vi.mocked(api.fetchOpenSessions).mockResolvedValueOnce({
      activeSessionId: "session-1",
      openSessionIds: ["session-1", "session-missing"],
    });
    vi.mocked(api.fetchSession).mockImplementation(async (id: string) => {
      if (id === "session-1") {
        return createTestServerSession({
          sessionId: "session-1",
          messages: [{ role: "user", content: "hello" }],
        });
      }
      throw new Error("404 Not found");
    });

    render(<RuntimeSync />);

    await waitFor(() => {
      expect(useSessionStore.getState().sessions.length).toBe(1);
    });

    expect(useSessionStore.getState().activeSessionId).toBe("session-1");
    expect(api.updateOpenSessions).toHaveBeenCalledWith({
      activeSessionId: "session-1",
      openSessionIds: ["session-1"],
    });
  });

  it("resyncs active sessions on socket connect", async () => {
    vi.mocked(api.fetchOpenSessions).mockResolvedValueOnce({
      activeSessionId: "session-1",
      openSessionIds: ["session-1"],
    });
    vi.mocked(api.fetchSession).mockResolvedValue(
      createTestServerSession({
        sessionId: "session-1",
        messages: [{ role: "user", content: "hello" }],
      }),
    );

    render(<RuntimeSync />);

    await waitFor(() => {
      expect(useSessionStore.getState().sessions.length).toBe(1);
    });

    vi.mocked(api.fetchSession).mockResolvedValueOnce(
      createTestServerSession({
        sessionId: "session-1",
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "reconnected response" },
        ],
      }),
    );

    mockSocket.emit("connect");

    await waitFor(() => {
      expect(useSessionStore.getState().sessions[0]?.messages.length).toBe(2);
    });
  });

  it("replaces a stale roster from the active session worker snapshot", async () => {
    vi.mocked(api.fetchOpenSessions).mockResolvedValueOnce({
      activeSessionId: "session-1",
      openSessionIds: ["session-1"],
    });
    vi.mocked(api.fetchSession).mockResolvedValue(
      createTestServerSession({ sessionId: "session-1" }),
    );
    useRosterStore.setState({
      bySession: {
        "session-1": [
          {
            id: "worker-stale",
            name: "worker-stale",
            taskId: "task-stale",
            task: "old",
            status: "completed",
            createdAt: "2026-08-22T00:00:00.000Z",
            updatedAt: "2026-08-22T00:01:00.000Z",
          },
        ],
      },
    });

    render(<RuntimeSync />);

    await waitFor(() => expect(api.fetchWorkers).toHaveBeenCalledWith("session-1"));
    await waitFor(() => expect(useRosterStore.getState().bySession["session-1"]).toEqual([]));
  });

  it("retries hydration upon socket reconnect if initial boot hydration failed", async () => {
    vi.mocked(api.fetchOpenSessions).mockRejectedValueOnce(new Error("network failure"));

    render(<RuntimeSync />);

    await waitFor(() => {
      expect(api.fetchOpenSessions).toHaveBeenCalledTimes(1);
    });

    vi.mocked(api.fetchOpenSessions).mockResolvedValueOnce({
      activeSessionId: "session-1",
      openSessionIds: ["session-1"],
    });
    vi.mocked(api.fetchSession).mockResolvedValueOnce(
      createTestServerSession({
        sessionId: "session-1",
        messages: [{ role: "user", content: "hello" }],
      }),
    );

    mockSocket.emit("connect");

    await waitFor(() => {
      expect(api.fetchOpenSessions).toHaveBeenCalledTimes(2);
      expect(useSessionStore.getState().sessions.length).toBe(1);
    });
  });

  it("enables open session persistence when user creates a session after initial hydration failure", async () => {
    vi.mocked(api.fetchOpenSessions).mockRejectedValueOnce(new Error("network failure"));

    render(<RuntimeSync />);

    await waitFor(() => {
      expect(api.fetchOpenSessions).toHaveBeenCalled();
    });

    useSessionStore.getState().addSession(
      createTestSession({
        sessionId: "new-user-session",
      }),
    );

    await waitFor(() => {
      expect(api.updateOpenSessions).toHaveBeenCalledWith({
        activeSessionId: "new-user-session",
        openSessionIds: ["new-user-session"],
      });
    });
  });

  it("does not create RuntimeStore tombstones for completed worker task IDs", async () => {
    vi.mocked(api.fetchOpenSessions).mockRejectedValueOnce(new Error("network failure"));
    useRuntimeStore.setState({ activity: {}, running: { "parent-session": true } });
    render(<RuntimeSync />);
    await waitFor(() => expect(api.fetchOpenSessions).toHaveBeenCalled());

    for (let index = 0; index < 3; index += 1) {
      mockSocket.emit("worker:completed", {
        sessionId: "parent-session",
        taskId: `task-${index}`,
        agentName: "worker",
        status: "done",
        summary: "complete",
      });
    }

    expect(useRuntimeStore.getState().running).toEqual({ "parent-session": true });
  });

  it("preserves an in-flight stream when delayed boot and worker hydration complete", async () => {
    const open = deferred<{ activeSessionId: string; openSessionIds: string[] }>();
    vi.mocked(api.fetchOpenSessions).mockReturnValueOnce(open.promise);
    vi.mocked(api.fetchSession).mockResolvedValueOnce(
      createTestServerSession({
        sessionId: "streaming-session",
        messages: [
          { role: "user", content: "old question" },
          { role: "assistant", content: "old answer" },
          { role: "user", content: "hello" },
          { role: "assistant", content: "intermediate durable tail" },
        ],
      }),
    );
    useSessionStore.setState({
      sessions: [
        createTestSession({
          sessionId: "streaming-session",
          messages: [
            createTestMessage({ id: "srv-0", role: "user", content: "old question" }),
            createTestMessage({ id: "srv-1", role: "assistant", content: "old answer" }),
            createTestMessage({ id: "optimistic-user", role: "user", content: "hello" }),
            createTestMessage({
              id: "stream-placeholder",
              role: "assistant",
              content: "partial live answer",
            }),
          ],
        }),
      ],
      activeSessionId: "streaming-session",
      serverSnapshotMessageCounts: { "streaming-session": 2 },
    });
    useSessionStore.getState().beginMessageStream("streaming-session", "stream-placeholder");

    render(<RuntimeSync />);
    open.resolve({
      activeSessionId: "streaming-session",
      openSessionIds: ["streaming-session"],
    });

    await waitFor(() => expect(api.fetchWorkers).toHaveBeenCalledWith("streaming-session"));
    expect(useSessionStore.getState().streamingMessageIds).toEqual({
      "streaming-session": ["stream-placeholder"],
    });
    expect(
      useSessionStore.getState().sessions[0]?.messages.map((message) => message.content),
    ).toEqual(["old question", "old answer", "hello", "partial live answer"]);
    expect(useSessionStore.getState().streamTurnBoundaries["streaming-session"]).toEqual({
      "stream-placeholder": {
        serverMessageCount: 2,
        userMessageId: "optimistic-user",
      },
    });
  });

  it("ignores worker hydration from a session that is no longer active", async () => {
    const workersA = deferred<Awaited<ReturnType<typeof api.fetchWorkers>>>();
    const workersB = deferred<Awaited<ReturnType<typeof api.fetchWorkers>>>();
    vi.mocked(api.fetchOpenSessions).mockResolvedValueOnce({
      activeSessionId: "session-a",
      openSessionIds: ["session-a", "session-b"],
    });
    vi.mocked(api.fetchSession).mockImplementation(async (sessionId: string) =>
      createTestServerSession({ sessionId }),
    );
    vi.mocked(api.fetchWorkers).mockImplementation((sessionId: string) =>
      sessionId === "session-a" ? workersA.promise : workersB.promise,
    );

    render(<RuntimeSync />);
    await waitFor(() => expect(api.fetchWorkers).toHaveBeenCalledWith("session-a"));
    useSessionStore.getState().setActiveSession("session-b");
    await waitFor(() => expect(api.fetchWorkers).toHaveBeenCalledWith("session-b"));
    workersB.resolve([
      {
        taskId: "task-b",
        workerSessionId: "worker-b",
        agentName: "Worker B",
        description: "current",
        status: "running",
        createdAt: "2026-08-24T00:00:00.000Z",
        updatedAt: "2026-08-24T00:00:01.000Z",
      },
    ]);
    await waitFor(() =>
      expect(useRosterStore.getState().bySession["session-b"]).toEqual([
        expect.objectContaining({ taskId: "task-b" }),
      ]),
    );
    workersA.resolve([
      {
        taskId: "stale-a",
        workerSessionId: "worker-a",
        agentName: "Worker A",
        description: "stale",
        status: "running",
        createdAt: "2026-08-23T00:00:00.000Z",
        updatedAt: "2026-08-23T00:00:01.000Z",
      },
    ]);
    await Promise.resolve();

    expect(useRosterStore.getState().bySession["session-a"]).toBeUndefined();
    expect(useRosterStore.getState().bySession["session-b"]).toEqual([
      expect.objectContaining({ taskId: "task-b" }),
    ]);
  });
});

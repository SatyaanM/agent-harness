import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { useRosterStore } from "@/stores/agent-roster-store";
import { useRuntimeStore } from "@/stores/runtime-store";
import { useSessionStore } from "@/stores/session-store";
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
        return {
          sessionId: "session-1",
          taskId: "task-1",
          prompt: "hello",
          messages: [{ role: "user", content: "hello" }],
          agentName: "orchestrator",
          createdAt: "2026-08-15T00:00:00.000Z",
        };
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
    vi.mocked(api.fetchSession).mockResolvedValue({
      sessionId: "session-1",
      taskId: "task-1",
      prompt: "hello",
      messages: [{ role: "user", content: "hello" }],
      agentName: "orchestrator",
      createdAt: "2026-08-15T00:00:00.000Z",
    });

    render(<RuntimeSync />);

    await waitFor(() => {
      expect(useSessionStore.getState().sessions.length).toBe(1);
    });

    vi.mocked(api.fetchSession).mockResolvedValueOnce({
      sessionId: "session-1",
      taskId: "task-1",
      prompt: "hello",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "reconnected response" },
      ],
      agentName: "orchestrator",
      createdAt: "2026-08-15T00:00:00.000Z",
    });

    mockSocket.emit("connect");

    await waitFor(() => {
      expect(useSessionStore.getState().sessions[0]?.messages.length).toBe(2);
    });
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
    vi.mocked(api.fetchSession).mockResolvedValueOnce({
      sessionId: "session-1",
      taskId: "task-1",
      prompt: "hello",
      messages: [{ role: "user", content: "hello" }],
      agentName: "orchestrator",
      createdAt: "2026-08-15T00:00:00.000Z",
    });

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

    useSessionStore.getState().addSession({
      sessionId: "new-user-session",
      messages: [],
      status: "active",
      agentName: "orchestrator",
      createdAt: "2026-08-15T00:00:00.000Z",
    });

    await waitFor(() => {
      expect(api.updateOpenSessions).toHaveBeenCalledWith({
        activeSessionId: "new-user-session",
        openSessionIds: ["new-user-session"],
      });
    });
  });
});

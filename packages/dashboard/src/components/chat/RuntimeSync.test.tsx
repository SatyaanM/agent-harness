import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RuntimeSync from "./RuntimeSync";
import { useSessionStore, type Session } from "@/stores/session-store";
import * as api from "@/lib/api";
import * as ws from "@/lib/ws";

vi.mock("@/lib/api", () => ({
  fetchOpenSessions: vi.fn(),
  fetchSession: vi.fn(),
  updateOpenSessions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ws", () => ({
  connectSocket: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
  })),
}));

const mockSession: Session = {
  sessionId: "s-1",
  messages: [],
  status: "idle",
  agentName: "agent-1",
  createdAt: "2026-08-29T00:00:00.000Z",
};

describe("RuntimeSync component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("hydrates open sessions from the server on mount", async () => {
    vi.mocked(api.fetchOpenSessions).mockResolvedValue({
      activeSessionId: "s-1",
      openSessionIds: ["s-1"],
    });
    vi.mocked(api.fetchSession).mockResolvedValue({
      sessionId: "s-1",
      messages: [],
    });

    render(<RuntimeSync />);

    await waitFor(() => {
      expect(api.fetchOpenSessions).toHaveBeenCalledTimes(1);
      expect(useSessionStore.getState().activeSessionId).toBe("s-1");
      expect(useSessionStore.getState().sessions).toHaveLength(1);
    });
  });

  it("does not call updateOpenSessions before hydration completes", async () => {
    let resolveOpenSessions!: (val: any) => void;
    const fetchOpenPromise = new Promise((resolve) => {
      resolveOpenSessions = resolve;
    });
    vi.mocked(api.fetchOpenSessions).mockReturnValue(fetchOpenPromise as any);

    render(<RuntimeSync />);

    // Mutate state while hydration is pending
    useSessionStore.setState({
      sessions: [mockSession],
      activeSessionId: "s-1",
    });

    // updateOpenSessions should NOT be called immediately while hydration is in flight
    expect(api.updateOpenSessions).not.toHaveBeenCalled();

    // Now resolve hydration
    resolveOpenSessions({
      activeSessionId: null,
      openSessionIds: [],
    });

    // After hydration resolves, queued pendingSync should flush
    await waitFor(() => {
      expect(api.updateOpenSessions).toHaveBeenCalled();
    });
  });
});

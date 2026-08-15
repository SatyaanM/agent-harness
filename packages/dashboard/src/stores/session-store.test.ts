import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "./session-store";

beforeEach(() => {
  useSessionStore.setState({ sessions: [], activeSessionId: null });
});

describe("session server synchronization", () => {
  it("clears a locally cached title when the authoritative server omits it", () => {
    useSessionStore.getState().addSession({
      sessionId: "one",
      messages: [],
      status: "active",
      agentName: "orchestrator",
      title: "Old title",
      createdAt: "2026-08-15T00:00:00.000Z",
    });

    useSessionStore.getState().syncFromServer({ sessionId: "one", messages: [] });

    expect(useSessionStore.getState().sessions[0]?.title).toBeUndefined();
  });
});

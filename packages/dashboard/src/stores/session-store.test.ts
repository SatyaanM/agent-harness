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

  it("replaces optimistic user and empty assistant placeholder with completed server messages without duplicating assistant response", () => {
    useSessionStore.getState().addSession({
      sessionId: "s-1",
      messages: [
        {
          id: "opt-user-1",
          role: "user",
          content: "What is 2+2?",
          createdAt: "2026-08-15T00:00:00.000Z",
        },
        {
          id: "opt-assistant-1",
          role: "assistant",
          content: "",
          createdAt: "2026-08-15T00:00:01.000Z",
        },
      ],
      status: "active",
      agentName: "orchestrator",
      createdAt: "2026-08-15T00:00:00.000Z",
    });

    useSessionStore.getState().syncFromServer({
      sessionId: "s-1",
      messages: [
        { role: "user", content: "What is 2+2?" },
        { role: "assistant", content: "4" },
      ],
    });

    const messages = useSessionStore.getState().sessions[0]?.messages;
    expect(messages).toEqual([
      expect.objectContaining({ id: "srv-0", role: "user", content: "What is 2+2?" }),
      expect.objectContaining({ id: "srv-1", role: "assistant", content: "4" }),
    ]);
  });

  it("preserves in-flight optimistic turn when server sync does not contain the user message yet", () => {
    useSessionStore.getState().addSession({
      sessionId: "s-1",
      messages: [
        {
          id: "srv-0",
          role: "user",
          content: "Initial message",
          createdAt: "2026-08-15T00:00:00.000Z",
        },
        {
          id: "srv-1",
          role: "assistant",
          content: "Initial response",
          createdAt: "2026-08-15T00:00:01.000Z",
        },
        {
          id: "opt-user-2",
          role: "user",
          content: "Follow-up question",
          createdAt: "2026-08-15T00:00:02.000Z",
        },
        {
          id: "opt-assistant-2",
          role: "assistant",
          content: "partial answer",
          createdAt: "2026-08-15T00:00:03.000Z",
        },
      ],
      status: "active",
      agentName: "orchestrator",
      createdAt: "2026-08-15T00:00:00.000Z",
    });

    useSessionStore.getState().syncFromServer({
      sessionId: "s-1",
      messages: [
        { role: "user", content: "Initial message" },
        { role: "assistant", content: "Initial response" },
      ],
    });

    const messages = useSessionStore.getState().sessions[0]?.messages;
    expect(messages?.map((m) => [m.role, m.content])).toEqual([
      ["user", "Initial message"],
      ["assistant", "Initial response"],
      ["user", "Follow-up question"],
      ["assistant", "partial answer"],
    ]);
  });
});

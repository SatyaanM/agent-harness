import { beforeEach, describe, expect, it } from "vitest";
import { createTestMessage, createTestSession } from "../test-helpers/session-fixtures";
import { type ServerSession, useSessionStore } from "./session-store";

function makeServerSession(overrides: Partial<ServerSession> = {}): ServerSession {
  return {
    sessionId: "s-1",
    messages: [],
    agentName: "orchestrator",
    createdAt: "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  useSessionStore.setState({
    sessions: [],
    activeSessionId: null,
    streamingMessageIds: {},
    awaitingAuthoritativeMessageIds: {},
    streamTurnBoundaries: {},
    serverSnapshotMessageCounts: {},
  });
});

describe("session server synchronization", () => {
  it("clears a locally cached title when the authoritative server omits it", () => {
    useSessionStore.getState().addSession(
      createTestSession({
        sessionId: "one",
        title: "Old title",
      }),
    );

    useSessionStore.getState().syncFromServer(
      makeServerSession({
        sessionId: "one",
        messages: [],
      }),
    );

    expect(useSessionStore.getState().sessions[0]?.title).toBeUndefined();
  });

  it("replaces optimistic user and empty assistant placeholder with completed server messages without duplicating assistant response", () => {
    useSessionStore.getState().addSession(
      createTestSession({
        sessionId: "s-1",
        messages: [
          createTestMessage({
            id: "opt-user-1",
            role: "user",
            content: "What is 2+2?",
            createdAt: "2026-08-15T00:00:00.000Z",
          }),
          createTestMessage({
            id: "opt-assistant-1",
            role: "assistant",
            content: "",
            createdAt: "2026-08-15T00:00:01.000Z",
          }),
        ],
      }),
    );

    useSessionStore.getState().syncFromServer(
      makeServerSession({
        sessionId: "s-1",
        messages: [
          { role: "user", content: "What is 2+2?" },
          { role: "assistant", content: "4" },
        ],
      }),
    );

    const messages = useSessionStore.getState().sessions[0]?.messages;
    expect(messages).toEqual([
      expect.objectContaining({ id: "srv-0", role: "user", content: "What is 2+2?" }),
      expect.objectContaining({ id: "srv-1", role: "assistant", content: "4" }),
    ]);
  });

  it("preserves in-flight optimistic turn when server sync does not contain the user message yet", () => {
    useSessionStore.getState().addSession(
      createTestSession({
        sessionId: "s-1",
        messages: [
          createTestMessage({
            id: "srv-0",
            role: "user",
            content: "Initial message",
            createdAt: "2026-08-15T00:00:00.000Z",
          }),
          createTestMessage({
            id: "srv-1",
            role: "assistant",
            content: "Initial response",
            createdAt: "2026-08-15T00:00:01.000Z",
          }),
          createTestMessage({
            id: "opt-user-2",
            role: "user",
            content: "Follow-up question",
            createdAt: "2026-08-15T00:00:02.000Z",
          }),
          createTestMessage({
            id: "opt-assistant-2",
            role: "assistant",
            content: "partial answer",
            createdAt: "2026-08-15T00:00:03.000Z",
          }),
        ],
      }),
    );

    useSessionStore.getState().syncFromServer(
      makeServerSession({
        sessionId: "s-1",
        messages: [
          { role: "user", content: "Initial message" },
          { role: "assistant", content: "Initial response" },
        ],
      }),
    );

    const messages = useSessionStore.getState().sessions[0]?.messages;
    expect(messages?.map((m) => [m.role, m.content])).toEqual([
      ["user", "Initial message"],
      ["assistant", "Initial response"],
      ["user", "Follow-up question"],
      ["assistant", "partial answer"],
    ]);
  });

  it("preserves a completed stream through a repeated intermediate sync without confirmation", () => {
    useSessionStore.getState().addSession(
      createTestSession({
        sessionId: "s-1",
        messages: [
          createTestMessage({ id: "opt-user", role: "user", content: "Research it" }),
          createTestMessage({
            id: "opt-assistant",
            role: "assistant",
            content: "First delta",
          }),
        ],
      }),
    );
    useSessionStore.getState().beginMessageStream("s-1", "opt-assistant");

    useSessionStore.getState().syncFromServer(
      makeServerSession({
        messages: [
          { role: "user", content: "Research it" },
          {
            role: "assistant",
            content: "I will inspect the source.",
            toolCalls: [{ toolCallId: "call-1", toolName: "inspect", args: {} }],
          },
          { role: "tool", content: "source result", toolCallId: "call-1" },
        ],
      }),
    );

    expect(useSessionStore.getState().sessions[0]?.messages).toEqual([
      expect.objectContaining({ id: "opt-user", role: "user", content: "Research it" }),
      expect.objectContaining({
        id: "opt-assistant",
        role: "assistant",
        content: "First delta",
      }),
    ]);

    useSessionStore.getState().updateMessage("s-1", "opt-assistant", "First delta continued");
    expect(useSessionStore.getState().sessions[0]?.messages.at(-1)).toEqual(
      expect.objectContaining({ id: "opt-assistant", content: "First delta continued" }),
    );

    useSessionStore.getState().finishMessageStream("s-1", "opt-assistant");
    expect(useSessionStore.getState().sessions[0]?.messages.at(-1)).toEqual(
      expect.objectContaining({ id: "opt-assistant", content: "First delta continued" }),
    );
    useSessionStore.getState().syncFromServer(
      makeServerSession({
        messages: [
          { role: "user", content: "Research it" },
          {
            role: "assistant",
            content: "I will inspect the source.",
            toolCalls: [{ toolCallId: "call-1", toolName: "inspect", args: {} }],
          },
          { role: "tool", content: "source result", toolCallId: "call-1" },
        ],
      }),
    );
    expect(useSessionStore.getState().sessions[0]?.messages.at(-1)).toEqual(
      expect.objectContaining({ id: "opt-assistant", content: "First delta continued" }),
    );
    expect(useSessionStore.getState().awaitingAuthoritativeMessageIds["s-1"]).toEqual([
      "opt-assistant",
    ]);
    useSessionStore.getState().syncFromServer(
      makeServerSession({
        messages: [
          { role: "user", content: "Research it" },
          {
            role: "assistant",
            content: "I will inspect the source.",
            toolCalls: [{ toolCallId: "call-1", toolName: "inspect", args: {} }],
          },
          { role: "tool", content: "source result", toolCallId: "call-1" },
          { role: "assistant", content: "The final answer." },
        ],
      }),
    );
    expect(useSessionStore.getState().sessions[0]?.messages).toEqual([
      expect.objectContaining({ id: "opt-user", role: "user", content: "Research it" }),
      expect.objectContaining({
        id: "opt-assistant",
        role: "assistant",
        content: "First delta continued",
      }),
    ]);
    useSessionStore.getState().confirmFromServer(
      makeServerSession({
        messages: [
          { role: "user", content: "Research it" },
          {
            role: "assistant",
            content: "I will inspect the source.",
            toolCalls: [{ toolCallId: "call-1", toolName: "inspect", args: {} }],
          },
          { role: "tool", content: "source result", toolCallId: "call-1" },
          { role: "assistant", content: "The final answer." },
        ],
      }),
    );

    expect(useSessionStore.getState().sessions[0]?.messages).toEqual([
      expect.objectContaining({ id: "srv-0", role: "user", content: "Research it" }),
      expect.objectContaining({
        id: "srv-1",
        role: "assistant",
        content: "I will inspect the source.",
      }),
      expect.objectContaining({ id: "srv-2", role: "tool", content: "source result" }),
      expect.objectContaining({
        id: "srv-3",
        role: "assistant",
        content: "The final answer.",
      }),
    ]);
  });

  it("waits for confirmation when the terminal sync arrives before SSE completion", () => {
    useSessionStore.getState().addSession(
      createTestSession({
        sessionId: "s-1",
        messages: [
          createTestMessage({ id: "opt-user", role: "user", content: "Question" }),
          createTestMessage({ id: "opt-assistant", role: "assistant", content: "partial" }),
        ],
      }),
    );
    useSessionStore.getState().beginMessageStream("s-1", "opt-assistant");
    useSessionStore.getState().syncFromServer(
      makeServerSession({
        messages: [
          { role: "user", content: "Question" },
          { role: "assistant", content: "durable answer" },
        ],
      }),
    );

    expect(useSessionStore.getState().sessions[0]?.messages.at(-1)?.id).toBe("opt-assistant");
    useSessionStore.getState().finishMessageStream("s-1", "opt-assistant");

    expect(useSessionStore.getState().sessions[0]?.messages.at(-1)?.id).toBe("opt-assistant");
    useSessionStore.getState().confirmFromServer(
      makeServerSession({
        messages: [
          { role: "user", content: "Question" },
          { role: "assistant", content: "durable answer" },
        ],
      }),
    );

    expect(useSessionStore.getState().sessions[0]?.messages).toEqual([
      expect.objectContaining({ id: "srv-0", role: "user", content: "Question" }),
      expect.objectContaining({ id: "srv-1", role: "assistant", content: "durable answer" }),
    ]);
  });

  it("projects only the pre-turn server baseline while a stream is active", () => {
    useSessionStore.getState().addSession(
      createTestSession({
        sessionId: "s-1",
        messages: [
          createTestMessage({ id: "srv-0", role: "assistant", content: "Earlier answer" }),
          createTestMessage({ id: "opt-user", role: "user", content: "Next question" }),
          createTestMessage({ id: "opt-assistant", role: "assistant", content: "live" }),
        ],
      }),
    );
    useSessionStore.getState().beginMessageStream("s-1", "opt-assistant");

    useSessionStore.getState().syncFromServer(
      makeServerSession({
        messages: [
          { role: "assistant", content: "Earlier answer" },
          { role: "user", content: "Next question" },
          { role: "assistant", content: "intermediate durable tail" },
        ],
      }),
    );

    expect(useSessionStore.getState().sessions[0]?.messages).toEqual([
      expect.objectContaining({ id: "srv-0", content: "Earlier answer" }),
      expect.objectContaining({ id: "opt-user", content: "Next question" }),
      expect.objectContaining({ id: "opt-assistant", content: "live" }),
    ]);
  });

  it("projects two pending turns and confirms them without losing the active turn", () => {
    useSessionStore.getState().addSession(
      createTestSession({
        sessionId: "s-1",
        messages: [
          createTestMessage({ id: "opt-user-a", role: "user", content: "Question A" }),
          createTestMessage({ id: "opt-assistant-a", role: "assistant", content: "live A" }),
        ],
      }),
    );
    useSessionStore.getState().beginMessageStream("s-1", "opt-assistant-a");
    useSessionStore.getState().finishMessageStream("s-1", "opt-assistant-a");
    const intermediateA = makeServerSession({
      messages: [
        { role: "user", content: "Question A" },
        {
          role: "assistant",
          content: "working A",
          toolCalls: [{ toolCallId: "call-a", toolName: "inspect", args: {} }],
        },
        { role: "tool", content: "result A", toolCallId: "call-a" },
      ],
    });
    useSessionStore.getState().syncFromServer(intermediateA);
    useSessionStore
      .getState()
      .addMessage(
        "s-1",
        createTestMessage({ id: "opt-user-b", role: "user", content: "Question B" }),
      );
    useSessionStore
      .getState()
      .addMessage(
        "s-1",
        createTestMessage({ id: "opt-assistant-b", role: "assistant", content: "live B" }),
      );
    useSessionStore.getState().beginMessageStream("s-1", "opt-assistant-b");

    const terminalA = makeServerSession({
      messages: [...intermediateA.messages, { role: "assistant", content: "durable A" }],
    });
    const intermediateB = makeServerSession({
      messages: [
        ...terminalA.messages,
        { role: "user", content: "Question B" },
        {
          role: "assistant",
          content: "working B",
          toolCalls: [{ toolCallId: "call-b", toolName: "inspect", args: {} }],
        },
        { role: "tool", content: "result B", toolCallId: "call-b" },
      ],
    });
    useSessionStore.getState().syncFromServer(intermediateB);
    expect(useSessionStore.getState().sessions[0]?.messages.map((message) => message.id)).toEqual([
      "opt-user-a",
      "opt-assistant-a",
      "opt-user-b",
      "opt-assistant-b",
    ]);

    useSessionStore.getState().confirmFromServer(terminalA, "opt-assistant-a");
    expect(useSessionStore.getState().sessions[0]?.messages.map((message) => message.id)).toEqual([
      "opt-user-a",
      "opt-assistant-a",
      "opt-user-b",
      "opt-assistant-b",
    ]);
    expect(useSessionStore.getState().awaitingAuthoritativeMessageIds["s-1"]).toEqual([
      "opt-assistant-a",
    ]);
    expect(useSessionStore.getState().streamingMessageIds["s-1"]).toEqual(["opt-assistant-b"]);

    useSessionStore.getState().finishMessageStream("s-1", "opt-assistant-b");
    const terminalB = makeServerSession({
      messages: [...intermediateB.messages, { role: "assistant", content: "durable B" }],
    });
    useSessionStore.getState().syncFromServer(terminalB);
    expect(useSessionStore.getState().sessions[0]?.messages.map((message) => message.id)).toEqual([
      "opt-user-a",
      "opt-assistant-a",
      "opt-user-b",
      "opt-assistant-b",
    ]);
    expect(useSessionStore.getState().awaitingAuthoritativeMessageIds["s-1"]).toEqual([
      "opt-assistant-a",
      "opt-assistant-b",
    ]);

    useSessionStore.getState().confirmFromServer(terminalA, "opt-assistant-a");
    expect(useSessionStore.getState().sessions[0]?.messages.map((message) => message.id)).toEqual([
      "opt-user-a",
      "opt-assistant-a",
      "opt-user-b",
      "opt-assistant-b",
    ]);
    expect(useSessionStore.getState().awaitingAuthoritativeMessageIds["s-1"]).toEqual([
      "opt-assistant-a",
      "opt-assistant-b",
    ]);

    useSessionStore.getState().confirmFromServer(terminalB, "opt-assistant-b");
    expect(useSessionStore.getState().sessions[0]?.messages).toEqual(
      terminalB.messages.map((message, index) =>
        expect.objectContaining({
          id: `srv-${index}`,
          role: message.role,
          content: message.content,
        }),
      ),
    );
    expect(useSessionStore.getState().streamingMessageIds["s-1"]).toBeUndefined();
    expect(useSessionStore.getState().awaitingAuthoritativeMessageIds["s-1"]).toBeUndefined();
    expect(useSessionStore.getState().streamTurnBoundaries["s-1"]).toBeUndefined();
  });

  it("keeps two awaiting turns until the later turn confirms the full transcript", () => {
    useSessionStore.getState().addSession(
      createTestSession({
        sessionId: "s-1",
        messages: [
          createTestMessage({ id: "user-a", role: "user", content: "A" }),
          createTestMessage({ id: "assistant-a", role: "assistant", content: "live A" }),
        ],
      }),
    );
    useSessionStore.getState().beginMessageStream("s-1", "assistant-a");
    useSessionStore.getState().finishMessageStream("s-1", "assistant-a");
    useSessionStore.getState().syncFromServer(
      makeServerSession({
        messages: [
          { role: "user", content: "A" },
          { role: "assistant", content: "durable A" },
        ],
      }),
    );
    useSessionStore
      .getState()
      .addMessage("s-1", createTestMessage({ id: "user-b", role: "user", content: "B" }));
    useSessionStore
      .getState()
      .addMessage(
        "s-1",
        createTestMessage({ id: "assistant-b", role: "assistant", content: "live B" }),
      );
    useSessionStore.getState().beginMessageStream("s-1", "assistant-b");
    useSessionStore.getState().finishMessageStream("s-1", "assistant-b");
    const durableTranscript = makeServerSession({
      messages: [
        { role: "user", content: "A" },
        { role: "assistant", content: "durable A" },
        { role: "user", content: "B" },
        { role: "assistant", content: "durable B" },
      ],
    });

    useSessionStore.getState().syncFromServer(durableTranscript);
    expect(useSessionStore.getState().sessions[0]?.messages.map((message) => message.id)).toEqual([
      "user-a",
      "assistant-a",
      "user-b",
      "assistant-b",
    ]);
    expect(useSessionStore.getState().awaitingAuthoritativeMessageIds["s-1"]).toEqual([
      "assistant-a",
      "assistant-b",
    ]);

    useSessionStore.getState().confirmFromServer(durableTranscript, "assistant-b");
    expect(useSessionStore.getState().sessions[0]?.messages.map((message) => message.id)).toEqual([
      "srv-0",
      "srv-1",
      "srv-2",
      "srv-3",
    ]);
    expect(useSessionStore.getState().awaitingAuthoritativeMessageIds["s-1"]).toBeUndefined();
    expect(useSessionStore.getState().streamTurnBoundaries["s-1"]).toBeUndefined();
  });

  it("retains a completed stream through a stale sync until its user is authoritative", () => {
    useSessionStore.getState().addSession(
      createTestSession({
        sessionId: "s-1",
        messages: [
          createTestMessage({ id: "opt-user", role: "user", content: "Question" }),
          createTestMessage({ id: "opt-assistant", role: "assistant", content: "answer" }),
        ],
      }),
    );
    useSessionStore.getState().beginMessageStream("s-1", "opt-assistant");
    useSessionStore.getState().finishMessageStream("s-1", "opt-assistant");

    useSessionStore.getState().syncFromServer(makeServerSession({ messages: [] }));

    expect(useSessionStore.getState().sessions[0]?.messages).toEqual([
      expect.objectContaining({ id: "opt-user", content: "Question" }),
      expect.objectContaining({ id: "opt-assistant", content: "answer" }),
    ]);

    useSessionStore.getState().confirmFromServer(
      makeServerSession({
        messages: [
          { role: "user", content: "Question" },
          { role: "assistant", content: "answer" },
        ],
      }),
    );
    expect(useSessionStore.getState().sessions[0]?.messages).toEqual([
      expect.objectContaining({ id: "srv-0", content: "Question" }),
      expect.objectContaining({ id: "srv-1", content: "answer" }),
    ]);
  });
});

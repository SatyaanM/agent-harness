import { BoundaryValidationError } from "@agent-harness/core/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestServerSession, createTestSessionMeta } from "../test-helpers/session-fixtures";
import {
  fetchAgentSource,
  fetchInboxFile,
  fetchOpenSessions,
  fetchSession,
  fetchSessions,
  parseChatStreamEvent,
  updateAgent,
  updateAgentSource,
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat stream boundary", () => {
  it("parses known stream events and rejects malformed events", () => {
    expect(parseChatStreamEvent('{"type":"text-delta","text":"hello"}')).toEqual({
      type: "text-delta",
      text: "hello",
    });
    expect(() => parseChatStreamEvent('{"type":"text-delta","text":42}')).toThrow(
      BoundaryValidationError,
    );
  });
});

describe("dashboard API boundary", () => {
  it("forwards cancellation to session requests", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json(
        createTestServerSession({
          sessionId: "worker",
          agentName: "worker",
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await fetchSession("worker", { signal: controller.signal });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url).endsWith("/api/sessions/worker")).toBe(true);
    expect(init).toEqual({ signal: controller.signal });
  });

  it("rejects an invalid JSON response before returning it to stores", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ activeSessionId: null, openSessionIds: ["valid", 42] })),
    );

    await expect(fetchOpenSessions()).rejects.toBeInstanceOf(BoundaryValidationError);
  });

  it("accepts a valid session response larger than the generic API budget @slow", async () => {
    const content = "x".repeat(950_000);
    const session = {
      sessionId: "large-session",
      taskId: "large-task",
      prompt: "large",
      messages: Array.from({ length: 11 }, () => ({ role: "user", content })),
      createdAt: "2026-08-12T00:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(session))),
    );

    await expect(fetchSession("large-session")).resolves.toMatchObject({
      sessionId: "large-session",
      messages: expect.arrayContaining([expect.objectContaining({ content })]),
    });
  });

  it("accepts a valid session whose separate mailbox pushes the response over 25 MB @slow", async () => {
    const content = "x".repeat(950_000);
    const session = {
      sessionId: "mailbox-heavy-session",
      taskId: "mailbox-heavy-task",
      prompt: "large",
      messages: Array.from({ length: 15 }, () => ({ role: "user", content })),
      mailbox: Array.from({ length: 15 }, (_value, index) => ({
        taskId: `task-${index}`,
        from: `worker-${index}`,
        agentName: "worker",
        status: "done",
        summary: content,
        receivedAt: "2026-08-15T00:00:00.000Z",
      })),
      createdAt: "2026-08-15T00:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(session))),
    );

    await expect(fetchSession("mailbox-heavy-session")).resolves.toMatchObject({
      sessionId: "mailbox-heavy-session",
      mailbox: expect.arrayContaining([expect.objectContaining({ summary: content })]),
    });
  });

  it("parses the session collection as metadata rather than full transcripts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          createTestSessionMeta({
            sessionId: "one",
            messageCount: 2,
          }),
        ]),
      ),
    );

    await expect(fetchSessions()).resolves.toEqual([
      expect.objectContaining({ sessionId: "one", messageCount: 2 }),
    ]);
  });

  it("accepts base64 expansion from a valid eight-megabyte inbox binary @slow", async () => {
    const content = `data:image/png;base64,${"A".repeat(10_666_668)}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: "large.png",
              name: "large.png",
              type: "png",
              size: 8_000_000,
              lastModified: "2026-08-12T00:00:00.000Z",
              content,
            }),
          ),
      ),
    );

    await expect(fetchInboxFile("large.png")).resolves.toMatchObject({ content });
  });

  it("round-trips agent source as a full server-owned document", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ source: "---\nname: test\n---" }))
      .mockResolvedValueOnce(
        Response.json({
          name: "test",
          model: "model",
          tools: [],
          maxSteps: 1,
          instructions: "",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAgentSource("test")).resolves.toBe("---\nname: test\n---");
    await updateAgentSource("test", "---\nname: test\n---");

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/api/agents/test/source"),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ source: "---\nname: test\n---" }),
      }),
    );
  });

  it("updates structured agent configuration via PUT /api/agents/:name", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        name: "orchestrator",
        model: "openai/gpt-4o",
        description: "Primary orchestrator",
        tools: ["run_command"],
        maxSteps: 10,
        instructions: "System prompt",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const updated = await updateAgent("orchestrator", {
      model: "openai/gpt-4o",
      description: "Primary orchestrator",
    });

    expect(updated.name).toBe("orchestrator");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/agents/orchestrator"),
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-4o", description: "Primary orchestrator" }),
      }),
    );
  });
});

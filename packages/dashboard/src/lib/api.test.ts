import { BoundaryValidationError } from "@agent-harness/core/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchInboxFile,
  fetchOpenSessions,
  fetchSession,
  fetchSessions,
  parseChatStreamEvent,
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
  it("rejects an invalid JSON response before returning it to stores", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ activeSessionId: null, openSessionIds: ["valid", 42] })),
    );

    await expect(fetchOpenSessions()).rejects.toBeInstanceOf(BoundaryValidationError);
  });

  it("accepts a valid session response larger than the generic API budget", async () => {
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

  it("accepts a valid session whose separate mailbox pushes the response over 25 MB", async () => {
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
          {
            sessionId: "one",
            prompt: "hello",
            createdAt: "2026-08-15T00:00:00.000Z",
            updatedAt: "2026-08-15T00:00:00.000Z",
            messageCount: 2,
          },
        ]),
      ),
    );

    await expect(fetchSessions()).resolves.toEqual([
      expect.objectContaining({ sessionId: "one", messageCount: 2 }),
    ]);
  });

  it("accepts base64 expansion from a valid eight-megabyte inbox binary", async () => {
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
});

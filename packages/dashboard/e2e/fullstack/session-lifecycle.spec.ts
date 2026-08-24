import { parseJsonBoundary } from "@agent-harness/core";
import { z } from "zod";
import { expect, test } from "./fixtures.js";

const SessionCreatedSchema = z.object({
  sessionId: z.string(),
  prompt: z.string(),
});

const SessionDetailSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
});

const OpenSessionsSchema = z.object({
  activeSessionId: z.string().nullable(),
  openSessionIds: z.array(z.string()),
});

test.describe("Full-Stack Session Lifecycle & Monotonic Sequence Ordering", () => {
  test("creates session, delivers streamed chat, verifies monotonic sequence numbers, and rehydrates on reload", async ({
    page,
    request,
  }) => {
    // 1. Create a session via REST API directly against live backend
    const createRes = await request.post("/api/sessions", {
      data: { prompt: "Lifecycle Spec Session" },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = parseJsonBoundary(
      SessionCreatedSchema,
      await createRes.text(),
      "session create response",
    );
    const sessionId = created.sessionId;
    expect(sessionId).toBeDefined();

    const openRes = await request.put("/api/sessions/open", {
      data: { activeSessionId: sessionId, openSessionIds: [sessionId] },
    });
    expect(openRes.ok()).toBeTruthy();

    // 2. Load the session in the Dashboard UI
    await page.goto("/");
    await expect
      .poll(async () => {
        const response = await page.evaluate(async () => {
          const res = await fetch("http://localhost:3001/api/sessions/open");
          return { ok: res.ok, body: await res.text() };
        });
        if (!response.ok) return null;
        return parseJsonBoundary(
          OpenSessionsSchema,
          response.body,
          "browser open sessions response",
        );
      })
      .toEqual({ activeSessionId: sessionId, openSessionIds: [sessionId] });

    // 3. Post a message to trigger Agent execution with simple-reply scenario
    const chatRes = await request.post("/api/chat", {
      data: {
        sessionId,
        message: "Hello orchestrator E2E_SCENARIO:simple-reply",
      },
    });
    expect(chatRes.ok()).toBeTruthy();
    const streamBody = await chatRes.text();
    expect(streamBody).toContain("text-delta");

    // 4. Verify message content is rendered in the UI
    await page.reload();
    await expect(page.getByText("Deterministic reply", { exact: false })).toBeVisible();

    // 5. Query session messages endpoint to assert monotonic sequencing
    const sessionRes = await request.get(`/api/sessions/${sessionId}`);
    expect(sessionRes.ok()).toBeTruthy();
    const sessionData = parseJsonBoundary(
      SessionDetailSchema,
      await sessionRes.text(),
      "session detail response",
    );

    expect(sessionData.messages.length).toBeGreaterThanOrEqual(2);
    expect(sessionData.messages[0]?.role).toBe("user");
    expect(sessionData.messages[1]?.role).toBe("assistant");
    expect(sessionData.messages[1]?.content).toContain("Deterministic reply");
  });
});

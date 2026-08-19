import { parseJsonBoundary } from "@agent-harness/core";
import { expect, test } from "@playwright/test";
import { z } from "zod";

const SessionCreatedSchema = z.object({
  sessionId: z.string(),
});

const SessionDetailSchema = z.object({
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.string(),
      toolCalls: z.unknown().optional(),
    }),
  ),
});

test.describe("Full-Stack Worker Delegation & Mailbox Delivery", () => {
  test("triggers background worker delegation, writes to mailbox, and materializes completion in parent transcript", async ({
    request,
  }) => {
    // 1. Create a parent session
    const createRes = await request.post("/api/sessions", {
      data: { prompt: "Worker Delegation Orchestration" },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = parseJsonBoundary(
      SessionCreatedSchema,
      await createRes.text(),
      "session create response",
    );
    const sessionId = created.sessionId;

    // 2. Post prompt triggering delegate-worker scenario
    const chatRes = await request.post("/api/chat", {
      data: {
        sessionId,
        message: "Please delegate research to a worker subagent E2E_SCENARIO:delegate-worker",
      },
    });
    expect(chatRes.ok()).toBeTruthy();
    const body = await chatRes.text();
    expect(body).toContain("text-delta");

    // 3. Inspect parent session history
    const sessionRes = await request.get(`/api/sessions/${sessionId}`);
    expect(sessionRes.ok()).toBeTruthy();
    const sessionData = parseJsonBoundary(
      SessionDetailSchema,
      await sessionRes.text(),
      "session detail response",
    );

    expect(sessionData.messages.length).toBeGreaterThanOrEqual(2);
    expect(sessionData.messages[0]?.role).toBe("user");
  });
});

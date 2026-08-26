import { parseJsonBoundary, WorkerSummaryListSchema } from "@agent-harness/core";
import { z } from "zod";
import { expect, test } from "./fixtures.js";

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

    // 3. Wait for the durable worker roster to reach a terminal state.
    await expect
      .poll(async () => {
        const workersRes = await request.get(`/api/sessions/${sessionId}/workers`);
        if (!workersRes.ok()) return false;
        const workers = parseJsonBoundary(
          WorkerSummaryListSchema,
          await workersRes.text(),
          "worker roster response",
        );
        return workers.length > 0 && workers.every((worker) => worker.status === "completed");
      })
      .toBe(true);

    // 4. Verify mailbox delivery was materialized in the parent transcript.
    await expect
      .poll(async () => {
        const sessionRes = await request.get(`/api/sessions/${sessionId}`);
        if (!sessionRes.ok()) return false;
        const sessionData = parseJsonBoundary(
          SessionDetailSchema,
          await sessionRes.text(),
          "session detail response",
        );
        return sessionData.messages.some((message) =>
          message.content.includes("background delegated execution materialized"),
        );
      })
      .toBe(true);
  });
});

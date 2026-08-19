import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { type EphemeralTestStack, startEphemeralTestStack } from "./test-stack.js";

const HealthSchema = z.object({
  status: z.string(),
});

const SessionCreateResponseSchema = z.object({
  sessionId: z.string(),
  prompt: z.string(),
});

interface MessageRow {
  sequence_num: number;
  role: string;
  content: string;
}

describe("Ephemeral Test Stack", () => {
  let stack: EphemeralTestStack;

  beforeEach(async () => {
    stack = await startEphemeralTestStack();
  });

  afterEach(async () => {
    if (stack) {
      await stack.teardown();
    }
  });

  it("boots isolated server, fake provider, and SQLite database", async () => {
    // 1. Health check server
    const serverHealth = await fetch(`${stack.serverUrl}/api/health`);
    expect(serverHealth.status).toBe(200);
    const healthJson = HealthSchema.parse(await serverHealth.json());
    expect(healthJson.status).toBe("ok");

    // 2. Health check fake provider
    const providerHealth = await fetch(`${stack.providerUrl}/health`);
    expect(providerHealth.status).toBe(200);

    // 3. Create a session via REST API
    const createRes = await fetch(`${stack.serverUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Integration Test Session" }),
    });
    expect(createRes.status).toBe(201);
    const created = SessionCreateResponseSchema.parse(await createRes.json());
    expect(created.sessionId).toBeDefined();
    expect(created.prompt).toBe("Integration Test Session");

    // 4. Send chat message to trigger Agent.run + Fake LLM
    const chatRes = await fetch(`${stack.serverUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: created.sessionId,
        message: "Hello orchestrator E2E_SCENARIO:simple-reply",
      }),
    });
    expect(chatRes.status).toBe(200);
    const streamContent = await chatRes.text();
    expect(streamContent).toContain("text-delta");

    // 5. Inspect SQLite directly to verify monotonic message sequences
    const db = stack.getDb();
    const rows = db
      .prepare<[string], MessageRow>(
        "SELECT sequence_num, role, content FROM messages WHERE session_id = ? ORDER BY sequence_num ASC",
      )
      .all(created.sessionId);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]?.role).toBe("user");
    expect(rows[0]?.sequence_num).toBe(0);
    expect(rows[1]?.role).toBe("assistant");
    expect(rows[1]?.sequence_num).toBe(1);
    expect(rows[1]?.content).toContain("Deterministic reply");
  });
});

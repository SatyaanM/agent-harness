import { parseJsonBoundary } from "@agent-harness/core";
import { z } from "zod";
import { expect, test } from "./fixtures.js";

const SessionIdSchema = z.object({
  sessionId: z.string(),
});

const OpenSessionsSchema = z.object({
  activeSessionId: z.string().nullable().optional(),
  openSessionIds: z.array(z.string()),
});

const SessionTitleSchema = z.object({
  title: z.string().optional(),
});

const SessionListSchema = z.array(
  z.object({
    sessionId: z.string(),
  }),
);

test.describe("Full-Stack Tab Management & Zero-Resurrection Deletion", () => {
  test("synchronizes open session tabs, renames session, and executes cascade deletion without resurrection", async ({
    request,
  }) => {
    // 1. Create two test sessions
    const res1 = await request.post("/api/sessions", {
      data: { prompt: "Tab Session Alpha" },
    });
    const s1 = parseJsonBoundary(SessionIdSchema, await res1.text(), "create session 1 response");

    const res2 = await request.post("/api/sessions", {
      data: { prompt: "Tab Session Beta" },
    });
    const s2 = parseJsonBoundary(SessionIdSchema, await res2.text(), "create session 2 response");

    expect(s1.sessionId).toBeDefined();
    expect(s2.sessionId).toBeDefined();

    // 2. Synchronize open session tabs
    const updateTabsRes = await request.put("/api/sessions/open", {
      data: {
        activeSessionId: s1.sessionId,
        openSessionIds: [s1.sessionId, s2.sessionId],
      },
    });
    expect(updateTabsRes.ok()).toBeTruthy();

    const openTabsRes = await request.get("/api/sessions/open");
    expect(openTabsRes.ok()).toBeTruthy();
    const openData = parseJsonBoundary(
      OpenSessionsSchema,
      await openTabsRes.text(),
      "open sessions response",
    );
    expect(openData.activeSessionId).toBe(s1.sessionId);
    expect(openData.openSessionIds).toContain(s2.sessionId);

    // 3. Rename session
    const renameRes = await request.patch(`/api/sessions/${s1.sessionId}`, {
      data: { title: "Renamed Alpha Session" },
    });
    expect(renameRes.ok()).toBeTruthy();

    const fetchRenamed = await request.get(`/api/sessions/${s1.sessionId}`);
    expect(fetchRenamed.ok()).toBeTruthy();
    const renamedData = parseJsonBoundary(
      SessionTitleSchema,
      await fetchRenamed.text(),
      "session rename response",
    );
    expect(renamedData.title).toBe("Renamed Alpha Session");

    // 4. Delete session s1
    const deleteRes = await request.delete(`/api/sessions/${s1.sessionId}`);
    expect(deleteRes.ok()).toBeTruthy();

    // 5. Verify zero-resurrection: GET /api/sessions/s1 returns 404
    const verifyDeleted = await request.get(`/api/sessions/${s1.sessionId}`);
    expect(verifyDeleted.status()).toBe(404);

    // 6. Verify session collection does not contain deleted session
    const listRes = await request.get("/api/sessions");
    expect(listRes.ok()).toBeTruthy();
    const listData = parseJsonBoundary(
      SessionListSchema,
      await listRes.text(),
      "session list response",
    );
    expect(listData.some((s) => s.sessionId === s1.sessionId)).toBe(false);
  });
});

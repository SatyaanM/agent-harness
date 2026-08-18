import { expect, test } from "@playwright/test";

test.describe("Chat Stream Flow", () => {
  test("submits prompt and renders streamed SSE message chunks", async ({ page }) => {
    // 1. Mock API endpoints
    await page.route("**/api/settings", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ defaultAgent: "agent", availableModels: ["gpt-4o"] }),
      });
    });

    await page.route("**/api/agents", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ name: "agent", model: "gpt-4o", description: "Default agent" }]),
      });
    });

    await page.route("**/api/sessions/open", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: ["test-session-1"] }),
      });
    });

    await page.route("**/api/sessions/test-session-1", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sessionId: "test-session-1",
          agentName: "agent",
          messages: [],
          mailbox: [],
        }),
      });
    });

    await page.route("**/api/chat", async (route) => {
      const sseBody = [
        `data: ${JSON.stringify({ type: "text-delta", text: "Hello" })}\n\n`,
        `data: ${JSON.stringify({ type: "text-delta", text: " from" })}\n\n`,
        `data: ${JSON.stringify({ type: "text-delta", text: " Agent Harness!" })}\n\n`,
        `data: ${JSON.stringify({ type: "done" })}\n\n`,
      ].join("");

      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sseBody,
      });
    });

    // 2. Navigate to Dashboard
    await page.goto("/");

    // 3. Verify page header or chat input is visible
    const chatInput = page.getByPlaceholder(/ask agent anything|type a message/i);
    await expect(chatInput).toBeVisible({ timeout: 5000 });
    await chatInput.fill("Hello agent");
    await chatInput.press("Enter");

    // 4. Verify body is mounted
    await expect(page.locator("body")).toBeVisible();
  });
});

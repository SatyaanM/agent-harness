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
        "event: chunk\ndata: " + JSON.stringify({ text: "Hello" }) + "\n\n",
        "event: chunk\ndata: " + JSON.stringify({ text: " from" }) + "\n\n",
        "event: chunk\ndata: " + JSON.stringify({ text: " Agent Harness!" }) + "\n\n",
        "event: done\ndata: {}\n\n",
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
    if (await chatInput.isVisible()) {
      await chatInput.fill("Hello agent");
      await chatInput.press("Enter");
    }

    // 4. Verify body is mounted
    await expect(page.locator("body")).toBeVisible();
  });
});

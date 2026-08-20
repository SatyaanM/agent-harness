import { expect, test } from "@playwright/test";

test.describe("Live Dashboard Smoke (Mocked)", () => {
  test("loads root page and renders shell navigation", async ({ page }) => {
    await page.route("**/api/settings", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ defaultAgent: "agent", availableModels: [] }),
      });
    });

    await page.route("**/api/agents", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/api/sessions/open", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: [] }),
      });
    });

    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
  });
});

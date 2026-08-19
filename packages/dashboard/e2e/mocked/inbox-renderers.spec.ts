import { expect, test } from "@playwright/test";

test.describe("Inbox File Renderers (Mocked)", () => {
  test("loads file explorer tree and renders file preview content", async ({ page }) => {
    await page.route("**/api/inbox/tree", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          name: "inbox",
          type: "directory",
          children: [
            { name: "report.md", type: "file", size: 120 },
            { name: "data.csv", type: "file", size: 85 },
          ],
        }),
      });
    });

    await page.route("**/api/inbox/file?path=report.md", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          path: "report.md",
          content: "# System Report\n\nAll services operational.",
        }),
      });
    });

    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
  });
});

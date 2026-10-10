import { expect, test, type Page } from "@playwright/test";

async function demoLogin(page: Page) {
  const response = await page.request.post("/api/auth/demo-login");
  expect(response.ok()).toBeTruthy();
}

async function openActionComposer(page: Page) {
  await demoLogin(page);
  await page.goto("/trpg/scroll-follow-lab?scenario=bot1");
  await page.waitForSelector("[data-trpg-scroll-follow-lab='true']", { timeout: 30_000 });
  await page.locator('[data-trpg-command-dock-tab="self"]').click();
  await page.locator('[data-trpg-command-dock-tab="action"]').click();
  await expect(page.locator("[data-trpg-next-action] textarea")).toBeVisible();
}

test.describe("TRPG action composer auto adjudication", () => {
  test("hides stat and action-type chips and keeps the textarea plus submit", async ({ page }) => {
    await openActionComposer(page);
    await expect(page.locator("[data-trpg-stat-selector]")).toHaveCount(0);
    await expect(page.locator("[data-trpg-action-chip]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "행동 제출" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "행동 예시" })).toBeVisible();
  });
});

import { expect, test, type Page } from "@playwright/test";
import { SR_PREFIX, SR_TAG, seedSearchRankingFixture } from "./helpers/searchRankingFixture";

test.use({ launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} });

test.beforeAll(async ({ request }) => {
  await request.get("/search");
  seedSearchRankingFixture(process.env.PLAYWRIGHT_DATA_DIR!);
});

async function noOverflow(page: Page) {
  const o = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(o.document).toBeLessThanOrEqual(o.viewport + 1);
}

const searchInput = (page: Page) => page.getByRole("searchbox").or(page.locator('input[name="q"]')).first();

test("search input follows the URL across history navigation", async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent(`${SR_PREFIX} 1위`)}`);
  const input = searchInput(page);
  await expect(input).toHaveValue(`${SR_PREFIX} 1위`);
  await input.fill(`${SR_PREFIX} 2위`);
  await input.press("Enter");
  await page.waitForURL(/q=.*2%EC%9C%84/);
  await expect(input).toHaveValue(`${SR_PREFIX} 2위`);
  await page.goBack();
  await page.waitForURL(/q=.*1%EC%9C%84/);
  await expect(input).toHaveValue(`${SR_PREFIX} 1위`);
  await page.goForward();
  await page.waitForURL(/q=.*2%EC%9C%84/);
  await expect(input).toHaveValue(`${SR_PREFIX} 2위`);
});

test("mobile search bar is large, clearable and does not overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/search?q=${encodeURIComponent(SR_PREFIX)}`);
  const box = await searchInput(page).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const clear = page.getByRole("button", { name: "검색어 지우기" });
  const cb = await clear.boundingBox();
  expect(cb!.width).toBeGreaterThanOrEqual(44);
  expect(cb!.height).toBeGreaterThanOrEqual(44);
  await clear.click();
  await expect(searchInput(page)).toHaveValue("");
  await expect(searchInput(page)).toBeFocused();
  await noOverflow(page);
});

test("search results stop at the 60 row limit and say so", async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent(SR_TAG)}`);
  await expect(page.getByTestId("search-summary")).toContainText("최대 60개 표시");
  await expect(page.getByRole("region", { name: "검색 결과" }).locator("article")).toHaveCount(60);
  await page.goto(`/search?q=${encodeURIComponent(`${SR_PREFIX} 1위`)}`);
  await expect(page.getByTestId("search-summary")).not.toContainText("최대 60개 표시");
});

test("empty search shows the query, the genre and a way back", async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent("없는작품zzq")}&g=${encodeURIComponent("로맨스")}`);
  const empty = page.getByTestId("search-empty");
  await expect(empty).toContainText("없는작품zzq");
  await expect(empty).toContainText("로맨스");
  await expect(empty.getByRole("link").first()).toBeVisible();
});

test("guest search never lists private, pending or adult works", async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent(SR_PREFIX)}`);
  const body = await page.locator("main").innerText();
  for (const hidden of ["비공개", "심사중", "성인"]) expect(body).not.toContain(`${SR_PREFIX} ${hidden}`);
});

test("ranking states its basis and keeps one continuous numbered list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tab/ranking");
  await expect(page.getByTestId("ranking-basis")).toContainText("누적 대화 턴");
  await expect(page.getByRole("link", { name: "전체", exact: true }).first()).toHaveAttribute("aria-current", "page");
  const rows = page.locator("ol > li[data-rank]");
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(5);
  const ranks = await rows.evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-rank"))));
  expect(ranks).toEqual(ranks.map((_, i) => i + 1));
  const hrefs = await rows.evaluateAll((els) => els.map((e) => e.querySelector("a")?.getAttribute("href")));
  expect(new Set(hrefs).size).toBe(hrefs.length);
  const first = await rows.nth(0).boundingBox();
  const fourth = await rows.nth(3).boundingBox();
  expect(first!.height).toBeGreaterThan(fourth!.height);
  await noOverflow(page);
  const body = await page.locator("main").innerText();
  for (const hidden of ["비공개", "심사중", "성인"]) expect(body).not.toContain(`${SR_PREFIX} ${hidden}`);
});

test("period ranking labels chat starts, not cumulative turns", async ({ page }) => {
  await page.goto("/tab/ranking?p=weekly");
  await expect(page.getByTestId("ranking-basis")).toContainText("대화가 시작된 횟수");
  await expect(page.getByRole("link", { name: "주간", exact: true }).first()).toHaveAttribute("aria-current", "page");
  const metric = await page.getByTestId("ranking-metric").first().innerText();
  expect(metric).toContain("대화 시작");
  expect(metric).not.toContain("누적");
});

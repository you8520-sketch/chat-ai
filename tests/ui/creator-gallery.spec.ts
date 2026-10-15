import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { galleryIds as ids, seedCreatorGalleryFixture } from "./helpers/creatorGalleryFixture";

test.use({ launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} });

test.beforeAll(async ({ request }) => {
  await request.get(`/creator/${ids.regular}`);
  seedCreatorGalleryFixture(process.env.PLAYWRIGHT_DATA_DIR!);
});

async function login(page: Page, kind: "regular" | "viewer" | "admin" | "disabled") {
  await page.context().addCookies([{ name: "session", value: `gallery-fixture-${kind}`,
    url: test.info().project.use.baseURL as string }]);
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
  expect(overflow.body).toBeLessThanOrEqual(overflow.viewport + 1);
}

test("gift action has a 44px touch target", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/creator/${ids.regular}`);
  const height = await page.getByRole("link", { name: "포인트 선물", exact: true })
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(height).toBeGreaterThanOrEqual(44);
});

test("evidence: identical fixture screenshots and geometry", async ({ page }) => {
  test.setTimeout(180_000);
  const dir = process.env.CREATOR_GALLERY_EVIDENCE_DIR;
  test.skip(!dir, "Set CREATOR_GALLERY_EVIDENCE_DIR to capture design evidence");
  fs.mkdirSync(dir!, { recursive: true });
  const measurements: unknown[] = [];
  async function capture(name: string, id: number, width = 390) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/creator/${id}`);
    await page.locator("main h1").waitFor();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map((img) => {
        // Full-page evidence also loads below-the-fold portraits.
        img.loading = "eager";
        return img.decode().catch(() => undefined);
      }));
    });
    await page.screenshot({ path: path.join(dir!, `${name}.png`), fullPage: true });
    measurements.push({ name, width, ...(await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      workCards: document.querySelectorAll('main article:has(> a)').length,
      giftButtonHeight: Array.from(document.querySelectorAll("main a, main button"))
        .find((el) => el.textContent?.includes("포인트 선물"))?.getBoundingClientRect().height,
    }))) });
  }
  for (const width of [360, 390, 768, 1440]) await capture(`regular-${width}`, ids.regular, width);
  for (const width of [390, 1440]) await capture(`long-${width}`, ids.long, width);
  await capture("empty-390", ids.empty);
  await capture("single-390", ids.single);
  await capture("official-390", ids.official);
  await capture("partner-1440", ids.partner, 1440);
  await capture("legacy-390", ids.legacy);
  await login(page, "viewer");
  await capture("community-390", ids.regular);
  await page.locator('input[placeholder="댓글을 입력하세요…"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(dir!, "comments-390.png") });
  await page.getByRole("button", { name: "포인트 선물", exact: true }).click();
  await page.screenshot({ path: path.join(dir!, "gift-390.png") });
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await login(page, "regular");
  await capture("owner-390", ids.regular);
  fs.writeFileSync(path.join(dir!, "geometry.json"), JSON.stringify(measurements, null, 2) + "\n");
});

for (const width of [360, 390, 768, 1440]) {
  test(`long names, HTML and notices stay inside ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/creator/${ids.long}`);
    await noOverflow(page);
    const latest = page.locator("#creator-notices details").first();
    await latest.locator("summary").click();
    await expect(latest).toHaveAttribute("open", "");
    await noOverflow(page);
    await expect(page.locator("#creator-works")).toBeVisible();
    expect(await page.getByRole("link", { name: "포인트 선물", exact: true }).evaluate((e) => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  });
}

test("popular works partition the existing ordered list without duplicates or private/pending rows", async ({ page }) => {
  await page.goto(`/creator/${ids.partner}`);
  await login(page, "admin");
  await page.reload();
  const cards = page.locator("main article:has(> a)");
  await expect(cards).toHaveCount(24);
  const values = await cards.evaluateAll((els) => els.map((el) => el.querySelector("a")?.getAttribute("href")));
  expect(new Set(values).size).toBe(24);
  expect(values).toEqual(Array.from({ length: 24 }, (_, n) => `/character/${ids.partner * 100 + n}`));
  await expect(page.getByText("공개되면 안 되는 작품", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "인기 작품", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "더 둘러보기", exact: true })).toBeVisible();
});

test("notice priority, archive and legacy HTML stay accessible", async ({ page }) => {
  await page.goto(`/creator/${ids.regular}`);
  await expect(page.getByText("구조화 공지가 있으면 숨겨지는 레거시 공지")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "새로운 이야기와 연재 일정 안내" })).toBeVisible();
  await page.getByText("이전 공지 2개", { exact: true }).click();
  await page.getByText("지난 소식 2", { exact: true }).click();
  await expect(page.locator("#creator-notices").getByText("지난 소식 2", { exact: true })).toBeVisible();
  await page.goto(`/creator/${ids.legacy}`);
  await expect(page.getByRole("heading", { name: "레거시 공지", exact: true })).toBeVisible();
  await noOverflow(page);
});

test("empty and single-work states have no empty notice area or repeated gallery", async ({ page }) => {
  await page.goto(`/creator/${ids.empty}`);
  await expect(page.locator("#creator-notices")).toHaveCount(0);
  await expect(page.getByText("아직 공개된 작품이 없습니다.", { exact: true })).toBeVisible();
  await expect(page.locator("main article:has(> a)")).toHaveCount(0);
  await page.goto(`/creator/${ids.single}`);
  await expect(page.locator("main article:has(> a)")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "더 둘러보기", exact: true })).toHaveCount(0);
});

test("official and partner identities preserve gift and dashboard eligibility", async ({ page }) => {
  await page.goto(`/creator/${ids.official}`);
  await expect(page.getByText("공식 스튜디오", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "포인트 선물", exact: true })).toHaveCount(0);
  await page.goto(`/creator/${ids.partner}`);
  await expect(page.getByText("✓ 공식 크리에이터", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "포인트 선물", exact: true })).toHaveAttribute("href", `/login?redirect=%2Fcreator%2F${ids.partner}`);
  await login(page, "regular");
  await page.goto(`/creator/${ids.regular}`);
  await expect(page.getByRole("link", { name: /크리에이터 대시보드/ })).toHaveAttribute("href", "/creator");
  await expect(page.getByRole("button", { name: "포인트 선물", exact: true })).toHaveCount(0);
  await expect(page.getByText("크리에이터 댓글 허용", { exact: true })).toBeVisible();
});

test("adult blur and destination stay owned by the shared card", async ({ page }) => {
  const card = page.locator(`article:has(a[href*="${ids.regular * 100 + 1}"])`);
  await page.goto(`/creator/${ids.regular}`);
  await expect(card.getByText("로그인 · 성인인증 필요", { exact: true })).toBeVisible();
  await expect(card.locator("a").first()).toHaveAttribute("href", /login/);
  await login(page, "admin");
  await page.reload();
  await expect(card.getByText("성인인증 필요", { exact: true })).toHaveCount(0);
  await expect(card.locator("a").first()).toHaveAttribute("href", `/character/${ids.regular * 100 + 1}`);
  await page.goto("/search?q=" + encodeURIComponent("달빛 아래의 약속"));
  await expect(page.locator(`article:has(a[href="/character/${ids.regular * 100}"])`).first()).toBeVisible();
});

test("community follows works; private, moderated and disabled states remain intact", async ({ page }) => {
  await page.goto(`/creator/${ids.regular}`);
  await expect(page.getByText("비공개 fixture 댓글", { exact: true })).toHaveCount(0);
  await expect(page.getByText("검수 fixture 원문", { exact: true })).toHaveCount(0);
  await login(page, "regular");
  await page.reload();
  await expect(page.getByText("비공개 fixture 댓글", { exact: true })).toBeVisible();
  await expect(page.getByText("검수 중", { exact: true })).toBeVisible();
  const positions = await page.evaluate(() => ({
    worksBottom: document.querySelector("#creator-works")!.getBoundingClientRect().bottom,
    communityTop: document.querySelector(".creator-gallery__community")!.getBoundingClientRect().top,
  }));
  expect(positions.communityTop).toBeGreaterThanOrEqual(positions.worksBottom);
  const input = page.getByPlaceholder("댓글을 입력하세요…");
  await page.setViewportSize({ width: 360, height: 420 });
  await input.fill("전송하지 않는 입력 확인");
  await input.scrollIntoViewIfNeeded();
  await noOverflow(page);
  expect(await input.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(100);
  await page.goto(`/creator/${ids.disabled}`);
  await expect(page.getByPlaceholder("댓글을 입력하세요…")).toHaveCount(0);
  await login(page, "disabled");
  await page.reload();
  await expect(page.getByText("크리에이터 댓글 허용", { exact: true })).toBeVisible();
});

test("gift dialog stays usable during small-height resize and returns focus", async ({ page }) => {
  await login(page, "viewer");
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/creator/${ids.long}`);
  const trigger = page.getByRole("button", { name: "포인트 선물", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const buttonHeights = await dialog.getByRole("button").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  expect(Math.min(...buttonHeights)).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 360, height: 360 });
  await dialog.getByRole("button", { name: "취소", exact: true }).scrollIntoViewIfNeeded();
  await noOverflow(page);
  const bounds = await dialog.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(360);
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

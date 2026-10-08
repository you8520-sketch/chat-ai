import { expect, test, type Page } from "@playwright/test";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function figureBox(page: Page, fixture: string) {
  const figure = page.locator(`[data-fixture="${fixture}"] figure`);
  await expect(figure).toHaveCount(1);
  const box = await figure.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function installImageRoutes(page: Page, release: Promise<void>) {
  await page.route("**/lab/slow-portrait.png", async (route) => {
    await release;
    await route.fulfill({ status: 200, contentType: "image/png", body: PNG });
  });
  await page.route("**/lab/missing-portrait.png", async (route) => {
    await route.fulfill({ status: 404, body: "missing" });
  });
}

test.describe("TRPG inline asset frame geometry", () => {
  test("mobile 360×740 keeps portraits short and landscapes full width", async ({ page }) => {
    let releaseSlow: () => void = () => {};
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    await installImageRoutes(page, slowGate);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/trpg/inline-asset-frame-lab", { waitUntil: "domcontentloaded" });

    const landscape = await figureBox(page, "landscape-16-9");
    const column = await page.locator('[data-fixture="landscape-16-9"]').boundingBox();
    expect(column).not.toBeNull();
    expect(landscape.width).toBeGreaterThan((column?.width ?? 0) - 2);
    expect(landscape.width).toBeGreaterThan(240);
    expect(Math.abs(landscape.height / landscape.width - 9 / 16)).toBeLessThan(0.03);

    const square = await figureBox(page, "square-1-1");
    expect(square.height).toBeLessThanOrEqual(222);
    expect(square.height).toBeGreaterThan(200);
    expect(Math.abs(square.width - square.height)).toBeLessThan(2);

    for (const id of ["portrait-2-3", "portrait-9-16", "extreme-1-8", "character-portrait"]) {
      const box = await figureBox(page, id);
      expect(box.height, id).toBeLessThanOrEqual(202);
      expect(box.height, id).toBeGreaterThan(180);
      expect(box.height, id).toBeLessThanOrEqual(740 * 0.32);
    }
    const poster = await figureBox(page, "portrait-9-16");
    expect(poster.width).toBeLessThan(140);
    const extreme = await figureBox(page, "extreme-1-8");
    expect(extreme.width).toBeLessThan(40);

    const unknown = await figureBox(page, "unknown");
    expect(unknown.height).toBeLessThanOrEqual(202);
    expect(unknown.height).toBeGreaterThan(100);

    const blurred = page.locator('[data-fixture="blurred-portrait"] img');
    await expect(blurred).toHaveClass(/blur-xl/);
    const blurredBox = await figureBox(page, "blurred-portrait");
    expect(blurredBox.height).toBeLessThanOrEqual(202);

    await expect(page.locator('[data-fixture="locked-character"] figure')).toHaveCount(0);
    await expect(page.locator('[data-fixture="locked-character"]')).toContainText("잠긴 초상 뒤");

    const chatImages = page.locator('[data-fixture="chat-inline"] [data-testid="inline-tagged-asset"]');
    await expect(chatImages).toHaveCount(1);
    await expect(chatImages).toHaveAttribute("data-asset-tag", "전투");
    expect(await chatImages.getAttribute("data-asset-orientation")).toBeNull();

    const portraitImg = page.locator('[data-fixture="portrait-9-16"] img');
    expect(await portraitImg.evaluate((el) => getComputedStyle(el).objectFit)).toBe("contain");
    const portraitFigure = page.locator('[data-fixture="portrait-9-16"] figure');
    const padding = await portraitFigure.evaluate((el) => {
      const style = getComputedStyle(el);
      return style.paddingTop + style.paddingBottom + style.paddingLeft + style.paddingRight;
    });
    expect(padding).toBe("0px0px0px0px");

    await expect(page.locator('[data-fixture="missing"] [data-role="before"]')).toContainText("앞 서술입니다");
    await expect(page.locator('[data-fixture="missing"] [data-role="after"]')).toContainText("뒤 대사입니다");
    await expect(page.locator('[data-fixture="portrait-2-3"]')).toContainText("대사가 남는다");

    const slowBefore = await figureBox(page, "slow");
    const anchorBefore = await page.locator('[data-fixture="extreme-1-8"] [data-role="after"]').boundingBox();
    releaseSlow();
    await expect(page.locator('[data-fixture="slow"] img')).toHaveJSProperty("complete", true);
    const slowAfter = await figureBox(page, "slow");
    const anchorAfter = await page.locator('[data-fixture="extreme-1-8"] [data-role="after"]').boundingBox();
    expect(Math.abs(slowBefore.height - slowAfter.height)).toBeLessThan(1);
    expect(Math.abs((anchorBefore?.y ?? 0) - (anchorAfter?.y ?? 0))).toBeLessThan(1);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-fixture="portrait-9-16"] figure')).toHaveCount(1);
    await expect(page.locator('[data-fixture="landscape-16-9"] figure')).toHaveCount(1);
    await page.screenshot({ path: "test-results/trpg-inline-mobile-top.png" });
    await page.locator('[data-fixture="portrait-9-16"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/trpg-inline-mobile-portrait.png" });
  });

  test("desktop 1440×900 caps portrait height and keeps landscape column width", async ({ page }) => {
    await page.route("**/lab/slow-portrait.png", async (route) => {
      await route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    });
    await page.route("**/lab/missing-portrait.png", async (route) => {
      await route.fulfill({ status: 404, body: "missing" });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/trpg/inline-asset-frame-lab");

    const landscape = await figureBox(page, "landscape-16-9");
    const column = await page.locator('[data-fixture="landscape-16-9"]').boundingBox();
    expect(landscape.width).toBeGreaterThan((column?.width ?? 0) - 2);
    expect(landscape.width).toBeGreaterThan(700);
    expect(landscape.height).toBeGreaterThan(400);

    for (const id of ["portrait-2-3", "portrait-9-16", "extreme-1-8", "character-portrait"]) {
      const box = await figureBox(page, id);
      expect(box.height, id).toBeLessThanOrEqual(242);
      expect(box.height, id).toBeGreaterThan(220);
      expect(box.height, id).toBeLessThanOrEqual(900 * 0.32);
    }
    const square = await figureBox(page, "square-1-1");
    expect(square.height).toBeLessThanOrEqual(282);
    expect(square.height).toBeGreaterThan(260);
    expect(Math.abs(square.width - square.height)).toBeLessThan(2);
    const characterWide = await figureBox(page, "character-landscape");
    expect(characterWide.width).toBeGreaterThan(700);
    await page.screenshot({ path: "test-results/trpg-inline-desktop-top.png" });
    await page.locator('[data-fixture="portrait-9-16"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/trpg-inline-desktop-portrait.png" });
  });
});

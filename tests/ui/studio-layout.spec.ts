import { expect, test, type Page } from "@playwright/test";

const STUDIO_TABS = [
  { id: "creations", url: "/studio" },
  { id: "worlds", url: "/studio?tab=worlds" },
  { id: "lorebooks", url: "/studio?tab=lorebooks" },
] as const;

const VIEWPORT_WIDTHS = [360, 390, 1280] as const;
const CREATE_PAGES = ["/create", "/world/create", "/lorebook/create"] as const;

async function demoLogin(page: Page) {
  const response = await page.request.post("/api/auth/demo-login");
  expect(response.ok()).toBeTruthy();
}

async function measureStudioLayout(page: Page) {
  await page.getByTestId("studio-tablist").waitFor({ state: "visible" });
  return page.evaluate(() => {
    const tablist = document.querySelector('[data-testid="studio-tablist"]');
    const tabpanel = document.querySelector('[data-testid="studio-tabpanel"]');
    const shell = document.querySelector('[data-testid="studio-page-shell"]');
    const main = document.querySelector("main") ?? document.body;
    const tabs = Array.from(tablist?.querySelectorAll('[role="tab"]') ?? []).map((tab) => {
      const rect = tab.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    });
    const stickySaveBars = Array.from(document.querySelectorAll<HTMLElement>("*"))
      .filter((el) => {
        const style = getComputedStyle(el);
        const text = el.textContent ?? "";
        return style.position === "sticky" && /저장|만들기|등록/.test(text);
      })
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          height: Math.round(rect.height),
        };
      });

    return {
      viewportWidth: window.innerWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      hasHorizontalScroll:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ||
        document.body.scrollWidth > document.documentElement.clientWidth + 1,
      tablistWidth: Math.round(tablist?.getBoundingClientRect().width ?? 0),
      tabpanelWidth: Math.round(tabpanel?.getBoundingClientRect().width ?? 0),
      shellWidth: Math.round(shell?.getBoundingClientRect().width ?? 0),
      mainWidth: Math.round(main.getBoundingClientRect().width),
      tabButtonWidths: tabs.map((tab) => tab.width),
      minTabButtonHeight: Math.min(...tabs.map((tab) => tab.height)),
      stickySaveBars,
    };
  });
}

test.describe("studio tab layout regression", () => {
  test.beforeEach(async ({ page }) => {
    await demoLogin(page);
  });

  for (const width of VIEWPORT_WIDTHS) {
    test(`keeps studio tab and container widths stable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });

      const measurements = [];
      for (const tab of STUDIO_TABS) {
        await page.goto(tab.url);
        measurements.push({ tab: tab.id, ...(await measureStudioLayout(page)) });
      }

      const [baseline] = measurements;
      expect(baseline).toBeTruthy();

      for (const measurement of measurements) {
        expect(measurement.hasHorizontalScroll, `${measurement.tab} horizontal scroll`).toBe(false);
        expect(measurement.tablistWidth, `${measurement.tab} tablist width`).toBe(
          baseline.tablistWidth,
        );
        expect(measurement.mainWidth, `${measurement.tab} main width`).toBe(baseline.mainWidth);
        expect(measurement.shellWidth, `${measurement.tab} shell width`).toBe(baseline.shellWidth);
        expect(measurement.tabpanelWidth, `${measurement.tab} tabpanel width`).toBe(
          baseline.tabpanelWidth,
        );
        expect(measurement.minTabButtonHeight, `${measurement.tab} tab touch height`).toBeGreaterThanOrEqual(
          44,
        );
        expect(new Set(measurement.tabButtonWidths).size, `${measurement.tab} equal tab buttons`).toBe(
          1,
        );
      }
    });
  }

  for (const path of CREATE_PAGES) {
    test(`does not let sticky save bar cover content on ${path}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto(path);
      const saveBar = page.getByTestId("studio-save-bar");
      await saveBar.waitFor({ state: "visible" });
      const geometry = await page.evaluate(() => {
        const saveBar = document.querySelector('[data-testid="studio-save-bar"]');
        const pageShell = document.querySelector("main") ?? document.body;
        const saveRect = saveBar?.getBoundingClientRect();
        const shellRect = pageShell.getBoundingClientRect();
        return {
          saveBarTop: Math.round(saveRect?.top ?? 0),
          saveBarBottom: Math.round(saveRect?.bottom ?? 0),
          saveBarHeight: Math.round(saveRect?.height ?? 0),
          shellBottom: Math.round(shellRect.bottom),
          bodyPaddingBottom: getComputedStyle(document.body).paddingBottom,
          hasHorizontalScroll:
            document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ||
            document.body.scrollWidth > document.documentElement.clientWidth + 1,
        };
      });

      expect(geometry.hasHorizontalScroll).toBe(false);
      expect(geometry.saveBarTop).toBeGreaterThanOrEqual(0);
      expect(geometry.saveBarBottom).toBeLessThanOrEqual(900);
      expect(geometry.shellBottom).toBeGreaterThan(geometry.saveBarTop);
    });
  }
});

test.describe("E4-7 creator menu and /create fixed bars", () => {
  test.beforeEach(async ({ page }) => {
    await demoLogin(page);
  });

  for (const width of [320, 390, 1280] as const) {
    test(`studio creator menu stays on one row without overlap at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/studio");
      const nav = page.getByTestId("studio-creator-nav");
      await nav.waitFor({ state: "visible" });
      const rects = await nav.locator("a").evaluateAll((links) =>
        links.map((a) => {
          const r = a.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, text: a.textContent?.trim() };
        }),
      );
      expect(rects.map((r) => r.text)).toEqual(["크리에이터 대시보드", "내 공개 프로필"]);
      expect(Math.abs(rects[0].top - rects[1].top)).toBeLessThan(2);
      expect(rects[0].right).toBeLessThanOrEqual(rects[1].left);
      expect(rects[1].right).toBeLessThanOrEqual(width);
      expect(rects[0].bottom - rects[0].top).toBeGreaterThanOrEqual(36);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflow).toBe(false);
    });
  }

  test("studio menu leads to the dashboard and to the user's own public profile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/studio");
    const profile = page.getByTestId("studio-creator-nav").getByRole("link", { name: "내 공개 프로필" });
    const href = await profile.getAttribute("href");
    expect(href).toMatch(/^\/creator\/\d+$/);
    await profile.click();
    await page.waitForURL(`**${href}`);
    await expect(page.getByRole("link", { name: /크리에이터 대시보드/ })).toBeVisible();

    await page.goto("/studio");
    await page.getByTestId("studio-creator-nav").getByRole("link", { name: "크리에이터 대시보드" }).click();
    await page.waitForURL("**/creator");
    await expect(page.getByRole("link", { name: "내 제작자 페이지" })).toHaveAttribute("href", href!);
    await page.getByRole("link", { name: "제작 스튜디오" }).first().click();
    await page.waitForURL("**/studio");
  });

  test("/create keeps scroll padding in step with header, tab bar, save bar, bottom nav and keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 667 });
    await page.goto("/create");
    const bar = page.getByTestId("studio-save-bar");
    await bar.waitFor({ state: "visible" });
    const read = () =>
      page.evaluate(() => {
        const root = document.documentElement;
        const cs = getComputedStyle(root);
        const nav = document.querySelector(".mobile-bottom-nav");
        const out = {
          top: parseFloat(cs.scrollPaddingTop),
          bottom: parseFloat(cs.scrollPaddingBottom),
          header: document.querySelector(".site-header")!.getBoundingClientRect().height,
          tabs: document.querySelector('[role="tablist"][aria-label="캐릭터·시뮬레이션 제작 탭"]')!.getBoundingClientRect().height,
          bar: document.querySelector('[data-testid="studio-save-bar"]')!.getBoundingClientRect().height,
          nav: nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect().height : 0,
        };
        return out;
      });
    const closed = await read();
    expect(closed.top).toBeGreaterThanOrEqual(closed.header + closed.tabs);
    expect(closed.bottom).toBeGreaterThanOrEqual(closed.bar + closed.nav);

    await page.evaluate(() => document.documentElement.style.setProperty("--keyboard-inset", "300px"));
    const open = await read();
    expect(open.bottom).toBeGreaterThanOrEqual(closed.bottom + 299);
  });

  test("/create jump lands the field title below the sticky header and tab bar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 667 });
    await page.goto("/create");
    await page.getByTestId("studio-save-bar").waitFor({ state: "visible" });
    const jump = page.getByTestId("studio-save-bar").getByRole("button", { name: /채우러 가기/ });
    await expect(jump).toBeVisible();
    await jump.click();
    await page.waitForTimeout(900);
    const geometry = await page.evaluate(() => {
      const el = document.activeElement as HTMLInputElement | null;
      const label = el?.labels?.[0]?.getBoundingClientRect();
      const tabs = document.querySelector('[role="tablist"][aria-label="캐릭터·시뮬레이션 제작 탭"]')!.getBoundingClientRect();
      const bar = document.querySelector('[data-testid="studio-save-bar"]')!.getBoundingClientRect();
      const box = el!.getBoundingClientRect();
      return { labelTop: label?.top ?? 0, tabsBottom: tabs.bottom, barTop: bar.top, boxBottom: box.bottom, boxTop: box.top };
    });
    expect(geometry.labelTop).toBeGreaterThanOrEqual(geometry.tabsBottom - 1);
    expect(geometry.boxTop).toBeGreaterThanOrEqual(geometry.tabsBottom - 1);
    expect(geometry.boxBottom).toBeLessThanOrEqual(geometry.barTop + 1);
  });
});

test.describe("lorebook editor fits the narrowest phone", () => {
  test("has no horizontal scroll at 320px with long keywords and keeps adding and removing them", async ({ page }) => {
    await demoLogin(page);
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/lorebook/create");
    const input = page.getByPlaceholder("키워드 입력 후 Enter");
    await input.waitFor({ state: "visible" });
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(await overflow()).toBe(false);

    for (const keyword of ["첫번째", "두번째 아주 긴 키워드 이름입니다 열두자 넘는"]) {
      await input.fill(keyword);
      await input.press("Enter");
    }
    await expect(page.locator('button[aria-label$="키워드 삭제"]')).toHaveCount(2);
    expect(await overflow()).toBe(false);
    await page.locator('button[aria-label="첫번째 키워드 삭제"]').click();
    await expect(page.locator('button[aria-label$="키워드 삭제"]')).toHaveCount(1);
    await expect(page.getByTestId("studio-save-bar")).toBeVisible();
  });
});

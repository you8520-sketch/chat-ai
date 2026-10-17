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

const FAKE_VISUAL_VIEWPORT = `(() => {
  const fake = new EventTarget();
  const state = { kb: 0 };
  const define = (key, read) => Object.defineProperty(fake, key, { get: read });
  define("width", () => innerWidth);
  define("height", () => innerHeight - state.kb);
  define("offsetTop", () => 0);
  define("offsetLeft", () => 0);
  define("pageTop", () => scrollY);
  define("pageLeft", () => 0);
  define("scale", () => 1);
  Object.defineProperty(window, "visualViewport", { get: () => fake });
  window.__setKeyboard = (kb) => { state.kb = kb; fake.dispatchEvent(new Event("resize")); };
})();`;

async function openEditorWithKeyboard(page: Page, width: number, height: number, keyboard: number) {
  await demoLogin(page);
  await page.addInitScript(FAKE_VISUAL_VIEWPORT);
  await page.setViewportSize({ width, height });
  await page.goto("/create");
  await page.getByTestId("studio-save-bar").waitFor({ state: "visible" });
  await page.evaluate((kb) => (window as unknown as { __setKeyboard: (k: number) => void }).__setKeyboard(kb), keyboard);
  await expect(page.locator("html")).toHaveAttribute("data-keyboard-open", "");
}

/** Pixels of the visual viewport left for the form once the sticky/fixed chrome is subtracted. */
async function freeEditingHeight(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForTimeout(150);
  return page.evaluate(() => {
    const rect = (el: Element | null) => el!.getBoundingClientRect();
    const fixedOrSticky = (el: Element | null) => !!el && ["fixed", "sticky"].includes(getComputedStyle(el).position);
    const header = document.querySelector(".site-header");
    const tabs = document.querySelector('[role="tablist"][aria-label="캐릭터·시뮬레이션 제작 탭"]');
    const bar = document.querySelector('[data-testid="studio-save-bar"]');
    const headerBottom = fixedOrSticky(header) ? rect(header).bottom : 0;
    const tabsStuck = fixedOrSticky(tabs) && rect(tabs).top <= headerBottom + 1;
    const top = Math.max(headerBottom, tabsStuck ? rect(tabs).bottom : 0);
    const bottom = fixedOrSticky(bar) ? rect(bar).top : window.visualViewport!.height;
    return { free: Math.round(bottom - top), tabs: getComputedStyle(tabs!).position, bar: getComputedStyle(bar!).position };
  });
}

test.describe("E4-9 editor on short landscape screens with the keyboard open", () => {
  for (const [width, height, keyboard] of [
    [667, 375, 190],
    [740, 360, 180],
    [844, 390, 200],
  ] as const) {
    test(`${width}x${height}: tab bar and save bar leave the fixed layer and the typed line stays visible`, async ({ page }) => {
      await openEditorWithKeyboard(page, width, height, keyboard);
      const open = await freeEditingHeight(page);
      expect(open.tabs).toBe("static");
      expect(open.bar).toBe("static");
      expect(open.free).toBeGreaterThanOrEqual(80);

      const textarea = page.locator("#studio-character-form textarea:visible").first();
      await textarea.click();
      await page.keyboard.type("첫 줄\n둘째 줄\n셋째 줄\n넷째 줄\n다섯째 줄 캐럿이 보여야 합니다");
      const geometry = await page.evaluate(() => {
        const ta = document.activeElement as HTMLTextAreaElement;
        const box = ta.getBoundingClientRect();
        const header = document.querySelector(".site-header")!.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, headerBottom: header.bottom, vv: window.visualViewport!.height };
      });
      expect(Math.min(geometry.bottom, geometry.vv) - Math.max(geometry.top, geometry.headerBottom)).toBeGreaterThanOrEqual(40);
      expect(await textarea.inputValue()).toContain("다섯째 줄 캐럿이 보여야 합니다");

      const save = page.getByTestId("studio-save-bar").getByRole("button").last();
      await save.scrollIntoViewIfNeeded();
      const reach = await save.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, headerBottom: document.querySelector(".site-header")!.getBoundingClientRect().bottom };
      });
      expect(reach.top).toBeGreaterThanOrEqual(reach.headerBottom - 1);
      expect(reach.bottom).toBeLessThanOrEqual(height);
    });
  }

  test("667x375: closing the keyboard restores the sticky tab bar, fixed save bar and scroll padding", async ({ page }) => {
    await openEditorWithKeyboard(page, 667, 375, 190);
    await page.evaluate(() => (window as unknown as { __setKeyboard: (k: number) => void }).__setKeyboard(0));
    await expect(page.locator("html")).not.toHaveAttribute("data-keyboard-open", "");
    const closed = await freeEditingHeight(page);
    expect(closed.tabs).toBe("sticky");
    expect(closed.bar).toBe("fixed");
    expect(closed.free).toBeGreaterThanOrEqual(140);
    const padding = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return { top: parseFloat(cs.scrollPaddingTop), bottom: parseFloat(cs.scrollPaddingBottom) };
    });
    expect(padding.top).toBeGreaterThan(98 + 54);
    expect(padding.bottom).toBeGreaterThan(69);
  });

  test("667x375: required-field jump anchors under the header only, since the tab bar is no longer sticky", async ({ page }) => {
    await openEditorWithKeyboard(page, 667, 375, 190);
    const jump = page.getByTestId("studio-save-bar").getByRole("button", { name: /채우러 가기/ });
    await jump.scrollIntoViewIfNeeded();
    await jump.click();
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const el = document.activeElement as HTMLInputElement;
            const labelTop = el.labels?.[0]?.getBoundingClientRect().top ?? 0;
            return labelTop - document.querySelector(".site-header")!.getBoundingClientRect().bottom;
          }),
        { timeout: 4000 },
      )
      .toBeGreaterThanOrEqual(-1);
    await page.waitForTimeout(600);
    const gap = await page.evaluate(() => {
      const el = document.activeElement as HTMLInputElement;
      return (el.labels?.[0]?.getBoundingClientRect().top ?? 0) - document.querySelector(".site-header")!.getBoundingClientRect().bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(-1);
    expect(gap).toBeLessThanOrEqual(30);
  });

  test("portrait phones keep the sticky tab bar and docked save bar while typing", async ({ page }) => {
    await openEditorWithKeyboard(page, 390, 844, 330);
    const open = await freeEditingHeight(page);
    expect(open.tabs).toBe("sticky");
    expect(open.bar).toBe("fixed");
  });
});

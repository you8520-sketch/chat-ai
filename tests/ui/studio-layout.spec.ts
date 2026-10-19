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

type KeyboardWindow = Window & { __setKeyboard: (kb: number) => void };

async function setKeyboard(page: Page, keyboard: number) {
  await page.evaluate((kb) => (window as unknown as KeyboardWindow).__setKeyboard(kb), keyboard);
  if (keyboard > 0) await expect(page.locator("html")).toHaveAttribute("data-keyboard-open", "");
  else await expect(page.locator("html")).not.toHaveAttribute("data-keyboard-open", "");
}

async function openEditorWithKeyboard(
  page: Page,
  path: string,
  width: number,
  height: number,
  keyboard: number,
  waitFor = '[data-testid="studio-save-bar"]',
) {
  await demoLogin(page);
  await page.addInitScript(FAKE_VISUAL_VIEWPORT);
  await page.setViewportSize({ width, height });
  await page.goto(path);
  await page.locator(waitFor).first().waitFor({ state: "visible" });
  if (keyboard > 0) await setKeyboard(page, keyboard);
}

/**
 * The band of the visual viewport the user can actually see and tap in: below the sticky header
 * (and the tab bar while it is stuck) and above the docked save bar or bottom nav. The bottom edge
 * is the visual viewport's own boundary, not the full layout innerHeight.
 */
const VISIBLE_BAND = `((ignoreBar) => {
  const rect = (el) => el.getBoundingClientRect();
  const pinned = (el) => !!el && ["fixed", "sticky"].includes(getComputedStyle(el).position);
  const header = document.querySelector(".site-header");
  const tabs = document.querySelector('[role="tablist"][aria-label="캐릭터·시뮬레이션 제작 탭"]');
  const bar = document.querySelector('[data-testid="studio-save-bar"]');
  const nav = document.querySelector(".mobile-bottom-nav");
  const vv = window.visualViewport;
  let top = pinned(header) ? rect(header).bottom : 0;
  if (pinned(tabs) && rect(tabs).top <= top + 1) top = Math.max(top, rect(tabs).bottom);
  let bottom = vv.offsetTop + vv.height;
  if (!ignoreBar && pinned(bar)) bottom = Math.min(bottom, rect(bar).top);
  if (nav && getComputedStyle(nav).display !== "none") bottom = Math.min(bottom, rect(nav).top);
  return { top, bottom };
})`;

interface Band {
  top: number;
  bottom: number;
}

async function visibleBand(page: Page, ignoreBar = false): Promise<Band> {
  return page.evaluate(`${VISIBLE_BAND}(${ignoreBar})`) as Promise<Band>;
}

/** Pixels of the visual viewport left for the form once the sticky/fixed chrome is subtracted. */
async function freeEditingHeight(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForTimeout(150);
  const band = await visibleBand(page);
  const positions = await page.evaluate(() => ({
    tabs: getComputedStyle(document.querySelector('[role="tablist"][aria-label="캐릭터·시뮬레이션 제작 탭"]')!).position,
    bar: getComputedStyle(document.querySelector('[data-testid="studio-save-bar"]')!).position,
  }));
  return { free: Math.round(band.bottom - band.top), ...positions };
}

/**
 * The save button counts as reachable only when it is fully inside the visual viewport below the
 * pinned header/tabs and hit-testable. The bar itself is not subtracted: the button lives in it.
 */
async function saveButtonReach(page: Page) {
  const band = await visibleBand(page, true);
  const hit = await page.getByTestId("studio-save-bar").getByRole("button").last().evaluate((el) => {
    const box = el.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const target = document.elementFromPoint(cx, cy);
    return { top: box.top, bottom: box.bottom, hit: !!target && (el === target || el.contains(target)) };
  });
  return { reachable: hit.hit && hit.top >= band.top - 0.5 && hit.bottom <= band.bottom + 0.5, band, ...hit };
}

/** Caret line of the focused textarea, measured with a mirror element (a textarea box alone says nothing about the caret). */
async function caretLine(page: Page) {
  return page.evaluate(() => {
    const ta = document.activeElement as HTMLTextAreaElement;
    const cs = getComputedStyle(ta);
    const mirror = document.createElement("div");
    for (const prop of [
      "boxSizing", "width", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
      "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
      "wordBreak", "textIndent", "tabSize",
    ] as const) {
      mirror.style[prop] = cs[prop];
    }
    Object.assign(mirror.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word", top: "0", left: "-9999px" });
    mirror.textContent = ta.value.slice(0, ta.selectionEnd);
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    const top = ta.getBoundingClientRect().top + (parseFloat(cs.borderTopWidth) || 0) + marker.offsetTop - ta.scrollTop;
    mirror.remove();
    return { top, bottom: top + lineHeight };
  });
}

/** Wheel-scroll like a user: coarse while the button is far below the fold, fine once it nears the visible band. */
async function wheelUntilReachable(page: Page, maxSteps = 120) {
  await page.mouse.move((page.viewportSize()?.width ?? 600) - 6, 200);
  for (let step = 0; step < maxSteps; step++) {
    const reach = await saveButtonReach(page);
    if (reach.reachable) return { ...reach, steps: step };
    const distance = reach.top - reach.band.bottom;
    const delta = distance > 240 ? 400 : reach.bottom < reach.band.top ? -20 : 20;
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(40);
  }
  return { ...(await saveButtonReach(page)), steps: maxSteps };
}

const ROOT_SCROLL_PADDING = `(() => {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  return {
    editor: root.hasAttribute("data-studio-editor"),
    keyboardOpen: root.hasAttribute("data-keyboard-open"),
    top: parseFloat(cs.scrollPaddingTop) || 0,
    bottom: parseFloat(cs.scrollPaddingBottom) || 0,
    saveBarVar: cs.getPropertyValue("--studio-save-bar-h").trim(),
    inlineScrollPadding: root.style.scrollPaddingTop || root.style.scrollPaddingBottom || "",
  };
})()`;

interface RootPadding {
  editor: boolean;
  keyboardOpen: boolean;
  top: number;
  bottom: number;
  saveBarVar: string;
  inlineScrollPadding: string;
}

async function rootPadding(page: Page): Promise<RootPadding> {
  return page.evaluate(ROOT_SCROLL_PADDING) as Promise<RootPadding>;
}

const SHORT_LANDSCAPE = [
  [667, 375, 190],
  [740, 360, 180],
  [844, 390, 200],
  [932, 430, 215],
] as const;

interface HeaderChrome {
  height: number;
  cssVar: number;
  strip: string;
  firstRow: boolean;
}

async function headerChrome(page: Page): Promise<HeaderChrome> {
  return page.evaluate(() => {
    const header = document.querySelector("header.site-header");
    if (!(header instanceof HTMLElement)) return { height: 0, cssVar: 0, strip: "missing", firstRow: false };
    const height = header.getBoundingClientRect().height;
    const cssVar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--site-header-height")) || 0;
    const strip = document.querySelector(".site-header-nav-strip");
    const row = header.children[0];
    const wanted = [
      row?.querySelector('a[aria-label$="홈"]'),
      row?.querySelector('button[aria-label^="알림"]'),
      row?.querySelector('[aria-label^="보유 포인트"]'),
      row?.querySelector('button[aria-label="프로필 메뉴"]'),
    ];
    const shown = (el: Element | null | undefined) => {
      if (!(el instanceof HTMLElement)) return false;
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    return {
      height,
      cssVar,
      strip: strip instanceof HTMLElement ? getComputedStyle(strip).display : "missing",
      firstRow: wanted.every(shown),
    };
  });
}

test.describe("E4-9 editor on short landscape screens with the keyboard open", () => {
  for (const [width, height, keyboard] of SHORT_LANDSCAPE) {
    test(`${width}x${height}: tab bar and save bar flow with the page and the caret line stays visible`, async ({ page }) => {
      await openEditorWithKeyboard(page, "/create", width, height, keyboard);
      const open = await freeEditingHeight(page);
      expect(open.tabs).toBe("static");
      expect(open.bar).toBe("static");
      expect(open.free).toBeGreaterThanOrEqual(80);

      const textarea = page.locator("#studio-character-form textarea:visible").first();
      await textarea.click();
      await textarea.evaluate((el: HTMLTextAreaElement) => {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
        set.call(el, Array.from({ length: 24 }, (_, i) => `줄 ${i + 1}: 캐럿이 가려지지 않아야 하는 긴 입력 문장입니다.`).join("\n"));
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await page.keyboard.press("Control+End");
      await page.keyboard.type("\n이어서 쓰는 마지막 줄");
      await page.waitForTimeout(300);

      const band = await visibleBand(page);
      const caret = await caretLine(page);
      expect(caret.top).toBeGreaterThanOrEqual(band.top - 1);
      expect(caret.bottom).toBeLessThanOrEqual(band.bottom + 1);
      expect(await textarea.inputValue()).toContain("이어서 쓰는 마지막 줄");
    });

    test(`${width}x${height}: save button is reachable by scrolling with the keyboard open, and by closing the keyboard`, async ({ page }) => {
      await openEditorWithKeyboard(page, "/create", width, height, keyboard);
      await page.locator("#studio-character-form textarea:visible").first().click();

      const atTop = await saveButtonReach(page);
      expect(atTop.reachable, "the form is long, so the bar starts below the fold").toBe(false);
      const scrolled = await wheelUntilReachable(page);
      expect(scrolled.reachable).toBe(true);
      expect(scrolled.bottom).toBeLessThanOrEqual(height - keyboard + 0.5);

      await page.evaluate(() => window.scrollTo(0, 0));
      await setKeyboard(page, 0);
      await page.waitForTimeout(150);
      const closed = await saveButtonReach(page);
      expect(closed.reachable).toBe(true);
      expect(closed.bottom).toBeLessThanOrEqual(height + 0.5);
    });
  }

  test("667x375: closing the keyboard restores the sticky tab bar, fixed save bar and scroll padding", async ({ page }) => {
    await openEditorWithKeyboard(page, "/create", 667, 375, 190);
    await setKeyboard(page, 0);
    const closed = await freeEditingHeight(page);
    expect(closed.tabs).toBe("sticky");
    expect(closed.bar).toBe("fixed");
    expect(closed.free).toBeGreaterThanOrEqual(140);
    const padding = await rootPadding(page);
    expect(padding.top).toBeGreaterThan(98 + 54);
    expect(padding.bottom).toBeGreaterThan(69);
  });

  test("667x375: reopening the keyboard and rotating keep the typed value and swap the layout both ways", async ({ page }) => {
    await openEditorWithKeyboard(page, "/create", 667, 375, 190);
    const field = page.locator("#studio-character-form input:visible").first();
    await field.fill("회전해도 남아야 하는 값");

    await setKeyboard(page, 0);
    expect((await freeEditingHeight(page)).bar).toBe("fixed");
    await setKeyboard(page, 190);
    const reopened = await freeEditingHeight(page);
    expect(reopened).toMatchObject({ tabs: "static", bar: "static" });

    await page.setViewportSize({ width: 375, height: 667 });
    await setKeyboard(page, 300);
    const portrait = await freeEditingHeight(page);
    expect(portrait).toMatchObject({ tabs: "sticky", bar: "fixed" });

    await page.setViewportSize({ width: 667, height: 375 });
    await setKeyboard(page, 190);
    const landscape = await freeEditingHeight(page);
    expect(landscape).toMatchObject({ tabs: "static", bar: "static" });
    expect(landscape.free).toBeGreaterThanOrEqual(80);
    await expect(field).toHaveValue("회전해도 남아야 하는 값");
  });

  test("667x375: required-field jump anchors under the header only, since the tab bar is no longer sticky", async ({ page }) => {
    await openEditorWithKeyboard(page, "/create", 667, 375, 190);
    const jump = page.getByTestId("studio-save-bar").getByRole("button", { name: /채우러 가기/ });
    await jump.scrollIntoViewIfNeeded();
    await jump.click();
    const labelGap = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLInputElement;
        const labelTop = el.labels?.[0]?.getBoundingClientRect().top ?? 0;
        return labelTop - document.querySelector(".site-header")!.getBoundingClientRect().bottom;
      });
    await expect.poll(labelGap, { timeout: 4000 }).toBeGreaterThanOrEqual(-1);
    await page.waitForTimeout(600);
    const gap = await labelGap();
    expect(gap).toBeGreaterThanOrEqual(-1);
    expect(gap).toBeLessThanOrEqual(30);
  });

  test("portrait phones keep the sticky tab bar and docked save bar while typing", async ({ page }) => {
    await openEditorWithKeyboard(page, "/create", 390, 844, 0);
    const closedHeader = await headerChrome(page);
    await setKeyboard(page, 330);
    const open = await freeEditingHeight(page);
    const openHeader = await headerChrome(page);
    expect(open.tabs).toBe("sticky");
    expect(open.bar).toBe("fixed");
    const reach = await saveButtonReach(page);
    expect(reach.reachable).toBe(true);
    expect(openHeader.strip).not.toBe("none");
    expect(Math.abs(openHeader.height - closedHeader.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(openHeader.cssVar - openHeader.height)).toBeLessThanOrEqual(1);
  });
});

test.describe("E4-10 the second header row folds only while a short editor has the keyboard open", () => {
  for (const [width, height, keyboard] of SHORT_LANDSCAPE) {
    test(`${width}x${height}: folding the menu row shortens the measured header and keeps the first row`, async ({ page }) => {
      await openEditorWithKeyboard(page, "/create", width, height, 0);
      const editable = page.locator("#studio-character-form input:visible").first();
      await editable.fill("메뉴를 접어도 남는 값");
      const fieldId = await editable.getAttribute("id");
      await page.getByRole("tab", { name: "공개 소개" }).click();
      const closed = await headerChrome(page);
      expect(closed.strip).not.toBe("none");
      expect(closed.firstRow).toBe(true);
      expect(Math.abs(closed.cssVar - closed.height)).toBeLessThanOrEqual(1);

      await setKeyboard(page, keyboard);
      await expect.poll(async () => {
        const open = await headerChrome(page);
        return open.strip === "none"
          && open.firstRow
          && open.height <= closed.height - 40
          && Math.abs(open.cssVar - open.height) <= 1;
      }).toBe(true);
      await expect(page.getByRole("tab", { name: "공개 소개" })).toHaveAttribute("aria-selected", "true");

      await setKeyboard(page, 0);
      await setKeyboard(page, keyboard);
      await expect(page.getByRole("tab", { name: "공개 소개" })).toHaveAttribute("aria-selected", "true");
      await setKeyboard(page, 0);
      await page.getByRole("tab", { name: "제작" }).click();
      await expect(page.locator(`[id="${fieldId}"]`)).toHaveValue("메뉴를 접어도 남는 값");

      await setKeyboard(page, 0);
      const restored = await headerChrome(page);
      expect(restored.strip).not.toBe("none");
      expect(restored.firstRow).toBe(true);
      expect(Math.abs(restored.height - closed.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(restored.cssVar - restored.height)).toBeLessThanOrEqual(1);
      const labels = await page.locator(".site-header-nav-strip a").allInnerTexts();
      expect(labels.map((label) => label.trim())).toEqual(["홈", "신작", "랭킹", "TRPG", "검색", "북마크/팔로잉"]);
    });
  }

  test("a tall desktop window keeps the inline menu while the keyboard is open", async ({ page }) => {
    await openEditorWithKeyboard(page, "/create", 1280, 800, 300);
    await expect(page.locator(".site-header").getByRole("link", { name: "검색" })).toBeVisible();
    const open = await headerChrome(page);
    expect(open.strip).not.toBe("none");
    expect(Math.abs(open.cssVar - open.height)).toBeLessThanOrEqual(1);
  });

  test("a short desktop window folds only the strip and leaves the inline menu", async ({ page }) => {
    await openEditorWithKeyboard(page, "/create", 1280, 430, 200);
    await expect(page.locator(".site-header").getByRole("link", { name: "검색" })).toBeVisible();
    const inlineVisible = await page.evaluate(() => {
      const row = document.querySelector("header.site-header")?.children[0];
      const nav = row?.querySelector('nav[aria-label="주요 메뉴"]');
      if (!(nav instanceof HTMLElement)) return false;
      const box = nav.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    expect(inlineVisible).toBe(true);
    await expect(page.locator(".site-header-nav-strip")).toBeHidden();
  });
});

async function expectSharedSaveBarRelease(page: Page) {
  const bar = page.getByTestId("studio-save-bar");
  await expect(bar).toBeVisible();
  const barPosition = () => bar.evaluate((el) => getComputedStyle(el).position);
  expect(await barPosition()).toBe("fixed");
  const closedHeader = await headerChrome(page);
  expect(closedHeader.strip).not.toBe("none");
  expect(Math.abs(closedHeader.cssVar - closedHeader.height)).toBeLessThanOrEqual(1);

  await setKeyboard(page, 190);
  await expect.poll(async () => {
    const openHeader = await headerChrome(page);
    return openHeader.strip === "none"
      && openHeader.height <= closedHeader.height - 40
      && Math.abs(openHeader.cssVar - openHeader.height) <= 1;
  }).toBe(true);
  expect(await barPosition()).toBe("static");
  const open = await rootPadding(page);
  expect(open.editor).toBe(true);
  expect(open.saveBarVar).toBe("0px");
  expect(open.bottom).toBe(190 + 8);

  const reach = await wheelUntilReachable(page);
  expect(reach.reachable).toBe(true);

  await setKeyboard(page, 0);
  expect(await barPosition()).toBe("fixed");
  await expect.poll(async () => {
    const restored = await headerChrome(page);
    return restored.strip !== "none"
      && Math.abs(restored.height - closedHeader.height) <= 1
      && Math.abs(restored.cssVar - restored.height) <= 1;
  }).toBe(true);
  const closed = await rootPadding(page);
  expect(closed.bottom).toBeGreaterThan(40);
  expect(closed.saveBarVar).not.toBe("0px");
}

test.describe("E4-9 the correction lives only while an editor is mounted", () => {
  const SHARED_EDITORS = [
    { path: "/create", wait: "#studio-character-form" },
    { path: "/world/create", wait: '[data-testid="studio-save-bar"]' },
    { path: "/lorebook/create", wait: '[data-testid="studio-save-bar"]' },
  ] as const;

  for (const editor of SHARED_EDITORS) {
    test(`${editor.path}: the shared save bar flows with the page at 667x375 with the keyboard open and docks again when it closes`, async ({ page }) => {
      await openEditorWithKeyboard(page, editor.path, 667, 375, 0, editor.wait);
      await expectSharedSaveBarRelease(page);
    });
  }

  test("owned scenario edit: the shared save bar flows with the page at 667x375 and docks again when the keyboard closes", async ({ page }) => {
    await demoLogin(page);
    await page.goto("/");
    // The session cookie is Secure. Create the row from the page so the browser sends it on http.
    const created = await page.evaluate(async () => {
      const res = await fetch("/api/trpg/scenarios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          title: "E4-9 회귀 시나리오",
          content: "시작 상황입니다. 키보드가 열려도 저장 버튼에 닿을 수 있어야 합니다.",
        }),
      });
      const json = (await res.json()) as { scenario?: { id?: number }; error?: string };
      return { ok: res.ok, status: res.status, id: json.scenario?.id ?? 0, error: json.error ?? "" };
    });
    expect(created.ok, `${created.status} ${created.error}`).toBe(true);
    expect(created.id).toBeGreaterThan(0);

    await openEditorWithKeyboard(page, `/trpg/scenarios/${created.id}`, 667, 375, 0);
    await expect(page.getByRole("heading", { name: "TRPG 시나리오 수정" })).toBeVisible();
    await expectSharedSaveBarRelease(page);
  });

  test("/trpg/scenarios/new opens simple create and does not apply the editor correction", async ({ page }) => {
    await openEditorWithKeyboard(page, "/trpg/scenarios/new", 667, 375, 0, "[data-trpg-simple-create]");
    await expect(page).toHaveURL(/\/world\/create\?tab=scenario/);
    await expect(page.getByRole("heading", { name: "TRPG 만들기" })).toBeVisible();
    await expect(page.getByTestId("studio-save-bar")).toHaveCount(0);

    const closed = await rootPadding(page);
    const closedHeader = await headerChrome(page);
    expect(closed.editor).toBe(false);
    expect(closed.saveBarVar).toBe("");
    expect(closed.inlineScrollPadding).toBe("");
    expect(closedHeader.strip).not.toBe("none");

    await setKeyboard(page, 190);
    const open = await rootPadding(page);
    const openHeader = await headerChrome(page);
    expect(open.editor).toBe(false);
    expect(open.keyboardOpen).toBe(true);
    expect(open.saveBarVar).toBe("");
    expect(open.inlineScrollPadding).toBe("");
    expect(open.top).toBe(closed.top);
    expect(open.bottom).toBe(closed.bottom);
    expect(openHeader.strip).not.toBe("none");
    expect(Math.abs(openHeader.height - closedHeader.height)).toBeLessThanOrEqual(1);
  });

  test("editor to non-editor navigation leaves no correction behind", async ({ page }) => {
    await openEditorWithKeyboard(page, "/create", 667, 375, 190);
    const inEditor = await rootPadding(page);
    expect(inEditor.editor).toBe(true);
    expect(inEditor.saveBarVar).toBe("0px");
    await expect(page.locator(".site-header-nav-strip")).toBeHidden();
    await expect(page.locator(".site-header").getByRole("link", { name: "검색" })).toHaveCount(0);

    const foldedFocus = await page.evaluate(() => {
      const link = document.querySelector(".site-header-nav-strip a");
      if (!(link instanceof HTMLElement)) return false;
      link.focus();
      return document.activeElement === link;
    });
    expect(foldedFocus).toBe(false);

    await setKeyboard(page, 0);
    await expect(page.locator(".site-header-nav-strip")).toBeVisible();
    await page.locator(".site-header").getByRole("link", { name: "검색" }).click();
    await page.waitForURL("**/search");
    await expect(page.locator("html")).not.toHaveAttribute("data-studio-editor", "");
    await expect(page.getByTestId("studio-save-bar")).toHaveCount(0);
    await expect(page.locator(".site-header-nav-strip")).toBeVisible();

    const closed = await rootPadding(page);
    await setKeyboard(page, 190);
    const afterNav = await rootPadding(page);
    expect(afterNav.editor).toBe(false);
    expect(afterNav.keyboardOpen).toBe(true);
    expect(afterNav.inlineScrollPadding).toBe("");
    expect(afterNav.saveBarVar).toBe("");
    expect(afterNav.top).toBe(closed.top);
    expect(afterNav.bottom).toBe(closed.bottom);
    await expect(page.locator(".site-header-nav-strip")).toBeVisible();
  });

  for (const path of ["/search", "/settings", "/persona"]) {
    test(`${path}: scroll padding does not change when the keyboard opens at 667x375`, async ({ page }) => {
      await openEditorWithKeyboard(page, path, 667, 375, 0, "main");
      const closed = await rootPadding(page);
      expect(closed.editor).toBe(false);

      await setKeyboard(page, 190);
      const open = await rootPadding(page);
      expect(open.editor).toBe(false);
      expect(open.saveBarVar).toBe("");
      expect(open.top).toBe(closed.top);
      expect(open.bottom).toBe(closed.bottom);
    });
  }
});

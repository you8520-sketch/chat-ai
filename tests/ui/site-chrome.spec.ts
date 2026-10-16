import { expect, test, type Page } from "@playwright/test";

test.use({ launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} });

async function demoLogin(page: Page) {
  const response = await page.request.post("/api/auth/demo-login");
  expect(response.ok()).toBeTruthy();
}

test.describe("home notice dialog", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("uses 44px targets, takes focus, closes on Escape and returns focus", async ({ page }) => {
    await page.goto("/");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    for (const target of [
      dialog.getByRole("button", { name: "공지 닫기" }),
      dialog.getByRole("button", { name: "확인" }),
      dialog.locator("label", { hasText: "오늘 하루 보지 않기" }),
    ]) {
      const box = await target.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }

    await expect(dialog.getByRole("button", { name: "확인" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("keeps Tab and Shift+Tab inside the open dialog", async ({ page }) => {
    await page.goto("/");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "확인" });
    const close = dialog.getByRole("button", { name: "공지 닫기" });
    await expect(confirm).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(close, "Tab from 확인 must wrap to the first dialog control").toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await expect(confirm, "Shift+Tab from the first control must wrap to 확인").toBeFocused();

    await page.keyboard.press("Shift+Tab");
    const stillInside = await page.evaluate(() => {
      const root = document.querySelector('[role="dialog"]');
      return !!(root && document.activeElement && root.contains(document.activeElement));
    });
    expect(stillInside).toBe(true);
  });

  test("restores focus after Escape, close, and confirm, and keeps hide-today policy", async ({ page }) => {
    await page.goto("/");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toMatch(/^(BODY|HTML)$/);

    await page.reload();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "공지 닫기" }).click();
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toMatch(/^(BODY|HTML)$/);

    await page.reload();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "확인" }).click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await expect(dialog).toBeVisible();

    await dialog.locator("label", { hasText: "오늘 하루 보지 않기" }).click();
    await dialog.getByRole("button", { name: "확인" }).click();
    await page.reload();
    await expect(dialog).toHaveCount(0);
  });
});

test.describe("mobile bottom menu", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps 제작 active on studio work screens and the creator dashboard root", async ({ page }) => {
    await demoLogin(page);
    for (const path of ["/studio", "/create", "/my-characters", "/creator"]) {
      await page.goto(path);
      const nav = page.getByRole("navigation", { name: "모바일 메뉴" });
      await expect(nav.getByRole("link", { name: "제작" }), path).toHaveAttribute("aria-current", "page");
      await expect(nav.locator('[aria-current="page"]'), path).toHaveCount(1);
    }
  });
});

test.describe("keyboard focus is not hidden behind fixed chrome", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Tab stops on /studio stay clear of the site header and bottom menu", async ({ page }) => {
    await demoLogin(page);
    await page.goto("/studio");
    await page.getByTestId("studio-tablist").waitFor({ state: "visible" });

    const hidden: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return null;
        const header = document.querySelector(".site-header")?.getBoundingClientRect();
        const nav = document.querySelector(".mobile-bottom-nav")?.getBoundingClientRect();
        const inHeader = !!el.closest(".site-header");
        const inNav = !!el.closest(".mobile-bottom-nav");
        const overlaps = (c?: DOMRect) => !!c && r.top < c.bottom - 1 && r.bottom > c.top + 1;
        return {
          label: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40),
          underHeader: !inHeader && overlaps(header),
          underNav: !inNav && overlaps(nav),
        };
      });
      if (info && (info.underHeader || info.underNav)) hidden.push(`${i}:${info.label}`);
    }
    expect(hidden).toEqual([]);
  });
});

const HEADER_WIDTHS = [360, 390, 575, 576, 768, 1023] as const;

async function headerMetrics(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector<HTMLElement>("header.site-header")!;
    const rect = header.getBoundingClientRect();
    const topRow = header.children[0] as HTMLElement;
    const controls = Array.from(topRow.querySelectorAll<HTMLElement>("a, button"))
      .filter((el) => !el.closest('nav[aria-label="주요 메뉴"]'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 16), l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height };
      })
      .filter((c) => c.w > 0 && c.h > 0);
    const overlaps: string[] = [];
    controls.forEach((a, i) => controls.slice(i + 1).forEach((c) => {
      if (Math.min(a.r, c.r) - Math.max(a.l, c.l) > 1 && Math.min(a.b, c.b) - Math.max(a.t, c.t) > 1) overlaps.push(`${a.label}|${c.label}`);
    }));
    const viewport = document.documentElement.clientWidth;
    const nav = Array.from(document.querySelectorAll<HTMLElement>('nav[aria-label="주요 메뉴"]')).find((n) => n.getBoundingClientRect().width > 0);
    const tabs = nav ? Array.from(nav.querySelectorAll<HTMLElement>("a")).map((a) => {
      const r = a.getBoundingClientRect();
      return { label: a.textContent!.trim(), h: r.height, l: r.left, r: r.right, active: a.getAttribute("aria-current") === "page", clipped: a.scrollWidth > a.clientWidth + 1 };
    }) : [];
    const navRect = nav?.getBoundingClientRect();
    return {
      height: rect.height,
      cssVar: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--site-header-height")),
      overlaps,
      offRight: controls.filter((c) => c.r > viewport + 0.5 || c.l < -0.5).map((c) => c.label),
      docOverflow: document.documentElement.scrollWidth > viewport + 1,
      tabs,
      navLeft: navRect?.left ?? 0,
      navRight: navRect?.right ?? 0,
    };
  });
}

async function focusedHeaderControl(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const r = el.getBoundingClientRect();
    const header = document.querySelector("header.site-header")!.getBoundingClientRect();
    const nav = el.closest<HTMLElement>('nav[aria-label="주요 메뉴"]');
    const navRect = nav?.getBoundingClientRect();
    return {
      label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 12),
      inHeader: !!el.closest("header.site-header"),
      inNav: !!nav,
      l: r.left,
      r: r.right,
      b: r.bottom,
      navL: navRect?.left ?? 0,
      navR: navRect?.right ?? 0,
      headerBottom: header.bottom,
      vw: document.documentElement.clientWidth,
    };
  });
}

const BALANCES = ["2,000P", "200,000P", "123,456,789P"] as const;
const MATRIX_WIDTHS = [360, 375, 390, 575, 576] as const;

async function applyBalanceAndBadge(page: Page, balance: string, badge: "0" | "99+") {
  await page.evaluate(({ balance, badge }) => {
    const points = document.querySelector<HTMLElement>('header.site-header [aria-label^="보유 포인트"]');
    const span = points?.querySelector("span") ?? points;
    if (span) span.textContent = balance;
    if (badge === "99+") {
      const bell = document.querySelector<HTMLElement>('header.site-header button[aria-label^="알림"]');
      const count = bell?.querySelector("span");
      if (count) count.textContent = "99+";
    }
  }, { balance, badge });
}

async function headerControlMatrix(page: Page, expectShopLink: boolean) {
  await page.request.post("/api/auth/demo-login");
  for (const width of MATRIX_WIDTHS) {
    for (const balance of BALANCES) {
      for (const badge of ["0", "99+"] as const) {
        const tag = `${width}px ${balance} badge ${badge}`;
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/tab/ranking");
        await applyBalanceAndBadge(page, balance, badge);
        const m = await headerMetrics(page);
        expect(m.overlaps, `${tag} overlaps`).toEqual([]);
        expect(m.offRight, `${tag} off-screen controls`).toEqual([]);
        expect(m.docOverflow, `${tag} overflow`).toBe(false);

        const detail = await page.evaluate(() => {
          const top = document.querySelector("header.site-header")!.children[0] as HTMLElement;
          const logo = top.querySelector<HTMLElement>('a[aria-label$="홈"]')!.getBoundingClientRect();
          const bell = top.querySelector<HTMLElement>('button[aria-label^="알림"]')!.getBoundingClientRect();
          const points = top.querySelector<HTMLElement>('[aria-label^="보유 포인트"]')!;
          const pointsText = points.querySelector("span") ?? points;
          const toggle = top.querySelector<HTMLElement>('button[aria-label="세이프티 필터"]')!;
          const shop = top.querySelector<HTMLElement>('a[href="/points"]');
          const state = Array.from(toggle.querySelectorAll<HTMLElement>("span"))
            .map((s) => s.textContent?.trim())
            .find((t) => t === "ON" || t === "OFF");
          return {
            logoToBell: bell.left - logo.right,
            pointsText: pointsText.textContent,
            pointsClipped: points.scrollWidth > points.clientWidth + 1,
            toggleHeight: toggle.getBoundingClientRect().height,
            togglePressed: toggle.getAttribute("aria-pressed"),
            toggleState: state ?? null,
            toggleVisibleText: toggle.innerText.trim(),
            shopHref: shop?.getAttribute("href") ?? null,
            shopW: shop?.getBoundingClientRect().width ?? 0,
            shopH: shop?.getBoundingClientRect().height ?? 0,
          };
        });
        expect(detail.logoToBell, `${tag} logo-to-bell gap`).toBeGreaterThanOrEqual(6);
        expect(detail.pointsText, `${tag} exact balance text`).toBe(balance);
        expect(detail.pointsClipped, `${tag} balance clipped`).toBe(false);
        expect(detail.toggleHeight, `${tag} toggle height`).toBeGreaterThanOrEqual(36);
        expect(detail.togglePressed, `${tag} toggle exposes state`).not.toBeNull();
        expect(detail.toggleState, `${tag} toggle shows ON/OFF text`).toBe(detail.togglePressed === "true" ? "ON" : "OFF");
        expect(detail.toggleVisibleText, `${tag} toggle label`).toContain("세이프티");
        if (expectShopLink) {
          expect(detail.shopHref, `${tag} charge link`).toBe("/points");
          expect(detail.shopW, `${tag} charge link width`).toBeGreaterThanOrEqual(36);
          expect(detail.shopH, `${tag} charge link height`).toBeGreaterThanOrEqual(36);
        }
      }
    }
  }
}

test.describe("compact mobile header", () => {
  test("below lg the header stays under 100px at every layout boundary and keeps one 64px row from lg", async ({ page }) => {
    for (const width of [...HEADER_WIDTHS, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tab/ranking");
      const m = await headerMetrics(page);
      if (width < 1024) expect(m.height, `${width}px header`).toBeLessThanOrEqual(100);
      else expect(m.height, `${width}px header`).toBeLessThanOrEqual(66);
      expect(m.docOverflow, `${width}px overflow`).toBe(false);
      expect(Math.abs(m.cssVar - m.height), `${width}px --site-header-height`).toBeLessThanOrEqual(1);
    }
  });

  test("keeps every menu tab at 44px, never clipped, with the active tab in view", async ({ page }) => {
    for (const width of [360, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/tab/following");
      await page.waitForTimeout(150);
      const m = await headerMetrics(page);
      expect(m.tabs.map((t) => t.label)).toEqual(["홈", "신작", "랭킹", "TRPG", "검색", "북마크/팔로잉"]);
      for (const t of m.tabs) {
        expect(t.h, `${width}px ${t.label}`).toBeGreaterThanOrEqual(44);
        expect(t.clipped, `${width}px ${t.label} clipped`).toBe(false);
      }
      const active = m.tabs.find((t) => t.active)!;
      expect(active.label).toBe("북마크/팔로잉");
      expect(active.l).toBeGreaterThanOrEqual(m.navLeft - 1);
      expect(active.r).toBeLessThanOrEqual(m.navRight + 1);
    }
  });

  test("payments OFF: header controls never overlap or overflow across balances, badges and widths", async ({ page }) => {
    await headerControlMatrix(page, false);
  });

  test("tapping the clipped last menu tab navigates and brings it fully into view", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto("/search");
    const link = page.locator('nav[aria-label="주요 메뉴"] a[href="/tab/following"]:visible').first();
    await link.tap();
    await page.waitForURL("**/tab/following");
    await page.waitForTimeout(150);
    const m = await headerMetrics(page);
    const active = m.tabs.find((t) => t.active)!;
    expect(active.label).toBe("북마크/팔로잉");
    expect(active.l).toBeGreaterThanOrEqual(m.navLeft - 1);
    expect(active.r).toBeLessThanOrEqual(m.navRight + 1);
    await context.close();
  });

  test("keyboard Tab walks the header controls then every menu tab, each focused tab fully inside the visible menu", async ({ page }) => {
    await demoLogin(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/tab/ranking");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const seen: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(150);
      const info = await focusedHeaderControl(page);
      if (!info.inHeader) break;
      seen.push(info.label);
      expect(info.l, `${info.label} left`).toBeGreaterThanOrEqual(-1);
      expect(info.r, `${info.label} right edge on screen`).toBeLessThanOrEqual(info.vw + 1);
      expect(info.b, `${info.label} bottom`).toBeLessThanOrEqual(info.headerBottom + 1);
      if (info.inNav) {
        expect(info.l, `${info.label} left edge inside the visible menu`).toBeGreaterThanOrEqual(info.navL - 1);
        expect(info.r, `${info.label} right edge inside the visible menu`).toBeLessThanOrEqual(info.navR + 1);
      }
    }
    for (const label of ["하브 홈", "홈", "신작", "랭킹", "TRPG", "검색", "북마크/팔로잉"]) {
      expect(seen.some((s) => s.includes(label)), `Tab reaches ${label}`).toBe(true);
    }
  });

  test("Shift+Tab, direct URL entry and back/forward keep the focused menu tab fully visible", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const walk = async (key: "Tab" | "Shift+Tab", steps: number, where: string) => {
      for (let i = 0; i < steps; i += 1) {
        await page.keyboard.press(key);
        await page.waitForTimeout(120);
        const info = await focusedHeaderControl(page);
        if (!info.inNav) continue;
        expect(info.l, `${where} ${key} ${info.label} left`).toBeGreaterThanOrEqual(info.navL - 1);
        expect(info.r, `${where} ${key} ${info.label} right`).toBeLessThanOrEqual(info.navR + 1);
      }
    };
    const focusTab = (selector: string) =>
      page.evaluate((sel) => {
        const nav = Array.from(document.querySelectorAll<HTMLElement>('nav[aria-label="주요 메뉴"]')).find((n) => n.getBoundingClientRect().width > 0);
        nav?.querySelector<HTMLElement>(sel)?.focus();
      }, selector);
    const focusActiveTab = () => focusTab('[aria-current="page"]');

    for (const path of ["/tab/following", "/tab/new", "/search"]) {
      await page.goto(path);
      await focusActiveTab();
      await walk("Tab", 5, `direct ${path}`);
      await walk("Shift+Tab", 6, `direct ${path}`);
    }

    await page.goto("/tab/ranking");
    await page.getByRole("navigation", { name: "주요 메뉴" }).first().getByRole("link", { name: "북마크/팔로잉" }).click();
    await page.waitForURL("**/tab/following");
    await page.goBack();
    await page.waitForURL("**/tab/ranking");
    await focusActiveTab();
    await walk("Tab", 6, "after back");
    await page.goForward();
    await page.waitForURL("**/tab/following");
    await focusActiveTab();
    await walk("Shift+Tab", 6, "after forward");

    const last = await page.evaluate(() => {
      const nav = Array.from(document.querySelectorAll<HTMLElement>('nav[aria-label="주요 메뉴"]')).find((n) => n.getBoundingClientRect().width > 0)!;
      nav.scrollLeft = 0;
      const link = nav.querySelector<HTMLElement>('a[href="/tab/following"]')!;
      return { clippedBeforeFocus: link.getBoundingClientRect().right > nav.getBoundingClientRect().right + 1 };
    });
    expect(last.clippedBeforeFocus, "the last tab starts clipped when the menu is scrolled to its start").toBe(true);
    await focusTab('a[href="/search"]');
    await walk("Tab", 1, "from 검색 to the last tab");
  });

  test("stays sticky after scrolling and drives the rail, scroll padding and --site-header-height", async ({ page }) => {
    await demoLogin(page);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/tab/ranking");
      await page.evaluate(() => window.scrollTo({ top: 600, behavior: "instant" }));
      await page.waitForTimeout(200);
      const m = await page.evaluate(() => {
        const header = document.querySelector("header.site-header")!.getBoundingClientRect();
        const rail = document.querySelector("aside.app-left-rail");
        const railRect = rail && getComputedStyle(rail).display !== "none" ? rail.getBoundingClientRect() : null;
        return {
          headerTop: header.top,
          headerBottom: header.bottom,
          railTop: railRect?.top ?? null,
          railBottom: railRect?.bottom ?? null,
          viewport: innerHeight,
          scrollPaddingTop: parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop),
        };
      });
      expect(Math.abs(m.headerTop), `${width}px sticky`).toBeLessThanOrEqual(1);
      expect(Math.abs(m.scrollPaddingTop - (m.headerBottom + 8)), `${width}px scroll-padding-top`).toBeLessThanOrEqual(1.5);
      if (m.railTop !== null) {
        expect(Math.abs(m.railTop - m.headerBottom), `${width}px rail top`).toBeLessThanOrEqual(1);
        expect(Math.abs(m.railBottom! - m.viewport), `${width}px rail bottom`).toBeLessThanOrEqual(1);
      }
    }
  });

  test("account controls still work: notification panel opens and the menu tabs navigate with history", async ({ page }) => {
    await demoLogin(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/tab/ranking");
    await page.getByRole("button", { name: /^알림/ }).first().click();
    await expect(page.getByRole("dialog", { name: "알림 센터" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "알림 센터" })).toHaveCount(0);
    const nav = page.getByRole("navigation", { name: "주요 메뉴" }).locator("visible=true");
    await nav.getByRole("link", { name: "검색" }).click();
    await page.waitForURL(/\/search/);
    await nav.getByRole("link", { name: "랭킹" }).click();
    await page.waitForURL(/\/tab\/ranking/);
    await page.goBack();
    await page.waitForURL(/\/search/);
    await expect(nav.getByRole("link", { name: "검색" })).toHaveAttribute("aria-current", "page");
    await page.goForward();
    await page.waitForURL(/\/tab\/ranking/);
    await expect(nav.getByRole("link", { name: "랭킹" })).toHaveAttribute("aria-current", "page");
  });
});

test.describe("page content start line", () => {
  async function leftOffsets(page: Page, path: string) {
    await page.goto(path);
    await page.locator("main h1").first().waitFor({ state: "visible" });
    return page.evaluate(() => {
      const main = document.querySelector("main")!.getBoundingClientRect();
      const h1 = document.querySelector("main h1")!.getBoundingClientRect();
      return { main: main.left, h1: h1.left, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
    });
  }

  test("제작 pages start at the shared main edge instead of adding a second 16px gutter", async ({ page }) => {
    await demoLogin(page);
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/studio", "/my-characters", "/creator", "/create"]) {
        const o = await leftOffsets(page, path);
        expect(Math.abs(o.h1 - o.main), `${width}px ${path} h1 vs main`).toBeLessThanOrEqual(1);
        expect(o.overflow, `${width}px ${path} overflow`).toBe(false);
      }
    }
  });

  test("narrow editor forms share the main edge below lg and stay centered readable forms on desktop", async ({ page }) => {
    await demoLogin(page);
    await page.setViewportSize({ width: 390, height: 900 });
    for (const path of ["/world/create", "/lorebook/create"]) {
      const o = await leftOffsets(page, path);
      expect(Math.abs(o.h1 - o.main), `390px ${path}`).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const o = await leftOffsets(page, "/world/create");
    expect(o.h1 - o.main, "desktop narrow form stays centered").toBeGreaterThan(100);
  });

  test("settings, persona and the creator dashboard keep the same start line as the discovery pages at every width", async ({ page }) => {
    await demoLogin(page);
    for (const width of [768, 960, 1000, 1023, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const ref = await leftOffsets(page, "/search");
      for (const path of ["/settings", "/persona", "/creator"]) {
        const o = await leftOffsets(page, path);
        expect(Math.abs(o.h1 - ref.h1), `${width}px ${path} vs /search`).toBeLessThanOrEqual(1);
      }
    }
  });
});

test.describe("rail geometry before hydration", () => {
  test("the left rail keeps its vertical position when the two-row header is measured below lg", async ({ page }) => {
    for (const width of [576, 768, 1023]) {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => {
        const w = window as unknown as { __railTopMove: number };
        w.__railTopMove = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as unknown as { sources?: { node?: Node; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[] }[]) {
            for (const source of entry.sources ?? []) {
              if (source.node instanceof Element && source.node.closest("aside.app-left-rail")) {
                w.__railTopMove += Math.abs(source.currentRect.top - source.previousRect.top);
              }
            }
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await page.goto("/tab/ranking");
      await page.waitForTimeout(1200);
      const move = await page.evaluate(() => (window as unknown as { __railTopMove: number }).__railTopMove);
      expect(move, `${width}px rail vertical shift`).toBeLessThanOrEqual(1);
    }
  });
});

const PAYMENTS_BASE_URL = process.env.PLAYWRIGHT_PAYMENTS_BASE_URL;

test.describe("compact mobile header with the charge shortcut", () => {
  test.skip(!PAYMENTS_BASE_URL, "needs a production server started with PORTONE_CHARGE_ENABLED=1 (set PLAYWRIGHT_PAYMENTS_BASE_URL)");
  test.use({ baseURL: PAYMENTS_BASE_URL });

  test("payments ON: logo, bell, safety filter, balance and charge link never overlap or overflow", async ({ page }) => {
    await headerControlMatrix(page, true);
  });
});

import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type Page, type Route } from "@playwright/test";
import { DEMO_USER_EMAIL } from "../../src/lib/demo";

test.use({ launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} });

async function demoLogin(page: Page) {
  const response = await page.request.post("/api/auth/demo-login");
  expect(response.ok()).toBeTruthy();
}

async function dismissHomeNotice(page: Page) {
  const dialog = page.locator('[role="dialog"][aria-labelledby="home-popup-notice-title"]');
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "확인", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }
}

async function openProfileMenu(page: Page) {
  await page.getByRole("button", { name: "프로필 메뉴" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

/** Isolated Playwright DB only. Does not change the shared webServer admin allow-list. */
function setDemoSafetyAccess(allowed: boolean): void {
  const dir = process.env.PLAYWRIGHT_DATA_DIR;
  if (!dir) throw new Error("PLAYWRIGHT_DATA_DIR is not set");
  const db = new DatabaseSync(path.join(dir, "app.db"));
  const updated = db
    .prepare("UPDATE users SET is_admin = ? WHERE lower(email) = lower(?)")
    .run(allowed ? 1 : 0, DEMO_USER_EMAIL);
  db.close();
  if (Number(updated.changes) !== 1) throw new Error("demo user was not updated");
}

async function loginAllowedAccount(page: Page) {
  await demoLogin(page);
  setDemoSafetyAccess(true);
}

function safetyToggle(page: Page) {
  return page.locator('[role="menu"] [role="menuitemcheckbox"]');
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
const MATRIX_WIDTHS = [320, 360, 375, 390, 575, 576] as const;

async function applyBalanceAndBadge(page: Page, balance: string, badge: "0" | "1" | "99+") {
  await page.evaluate(({ balance, badge }) => {
    const points = document.querySelector<HTMLElement>('header.site-header [aria-label^="보유 포인트"]');
    const span = points?.querySelector("span") ?? points;
    if (span) span.textContent = balance;
    const bell = document.querySelector<HTMLElement>('header.site-header button[aria-label^="알림"]');
    const count = bell?.querySelector("span");
    if (badge === "0") {
      if (count) count.style.display = "none";
    } else if (count) {
      count.style.display = "";
      count.textContent = badge;
    }
  }, { balance, badge });
}

async function headerControlMatrix(page: Page, expectShopLink: boolean) {
  await page.request.post("/api/auth/demo-login");
  for (const width of MATRIX_WIDTHS) {
    for (const balance of BALANCES) {
      for (const badge of ["0", "1", "99+"] as const) {
        const tag = `${width}px ${balance} badge ${badge}`;
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/tab/ranking");
        await dismissHomeNotice(page);
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
          const headerSafetyFilter = top.querySelector('button[aria-label="세이프티 필터"]');
          const shop = top.querySelector<HTMLElement>('a[href="/points"]');
          return {
            logoToBell: bell.left - logo.right,
            pointsText: pointsText.textContent,
            pointsClipped: points.scrollWidth > points.clientWidth + 1,
            headerSafetyFilter: headerSafetyFilter !== null,
            shopHref: shop?.getAttribute("href") ?? null,
            shopW: shop?.getBoundingClientRect().width ?? 0,
            shopH: shop?.getBoundingClientRect().height ?? 0,
          };
        });
        expect(detail.logoToBell, `${tag} logo-to-bell gap`).toBeGreaterThanOrEqual(6);
        expect(detail.pointsText, `${tag} exact balance text`).toBe(balance);
        expect(detail.pointsClipped, `${tag} balance clipped`).toBe(false);
        expect(detail.headerSafetyFilter, `${tag} header safety filter removed`).toBe(false);
        if (expectShopLink) {
          expect(detail.shopHref, `${tag} charge link`).toBe("/points");
          expect(detail.shopW, `${tag} charge link width`).toBeGreaterThanOrEqual(36);
          expect(detail.shopH, `${tag} charge link height`).toBeGreaterThanOrEqual(36);
        }
      }
    }
  }
}

test.describe("profile menu safety filter", () => {
  for (const width of [320, 390, 1280] as const) {
    test(`${width}px keeps the filter out of the header and once below albums in the menu`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
      await demoLogin(page);
      await page.goto("/tab/ranking");
      await dismissHomeNotice(page);
      const headerHasFilter = await page.evaluate(
        () => !!document.querySelector('header.site-header button[aria-label="세이프티 필터"]'),
      );
      expect(headerHasFilter).toBe(false);
      await openProfileMenu(page);
      const menu = page.getByRole("menu");
      const order = await menu.evaluate((el) =>
        Array.from(el.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')).map((node) =>
          (node.textContent ?? "").trim().slice(0, 12),
        ),
      );
      expect(order[0]).toContain("설정");
      expect(order[1]).toContain("앨범");
      expect(order[2]).toContain("세이프티");
      await expect(menu.getByRole("menuitemcheckbox", { name: /세이프티 필터/ })).toHaveCount(1);
    });
  }

  test("390px toggles OFF, keeps the menu open, and matches settings after reload", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAllowedAccount(page);
    await page.goto("/tab/ranking");
    await dismissHomeNotice(page);
    await openProfileMenu(page);
    const toggle = page.getByRole("menuitemcheckbox", { name: /세이프티 필터 OFF/ });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByRole("menuitemcheckbox", { name: /세이프티 필터 ON/ })).toBeVisible();
    await page.reload();
    await dismissHomeNotice(page);
    await openProfileMenu(page);
    await expect(page.getByRole("menuitemcheckbox", { name: /세이프티 필터 ON/ })).toBeVisible();
    await page.goto("/settings");
    await expect(page.getByRole("switch", { name: "세이프티 필터" })).toHaveAttribute("aria-checked", "true");
  });

  test("a regular member cannot toggle the profile filter and no PATCH is sent", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const patches: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url().includes("/api/settings")) patches.push(request.url());
    });
    await demoLogin(page);
    setDemoSafetyAccess(false);
    await page.goto("/tab/ranking");
    await dismissHomeNotice(page);
    await openProfileMenu(page);
    const toggle = safetyToggle(page);
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click({ force: true });
    await page.waitForTimeout(300);
    expect(patches).toEqual([]);
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("closing and reopening during a delayed PATCH keeps one in-flight save", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let release: (() => void) | null = null;
    let patches = 0;
    await page.route("**/api/settings", async (route: Route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      patches += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.continue();
    });
    await loginAllowedAccount(page);
    await page.goto("/tab/ranking");
    await dismissHomeNotice(page);
    await openProfileMenu(page);
    await safetyToggle(page).click();
    await expect(safetyToggle(page)).toBeDisabled();
    await expect(safetyToggle(page)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="menu"]')).toBeHidden();
    await openProfileMenu(page);
    await expect(safetyToggle(page)).toBeDisabled();
    await expect(safetyToggle(page)).toHaveAttribute("aria-checked", "true");
    await safetyToggle(page).click({ force: true });
    expect(patches).toBe(1);
    release?.();
    await expect(safetyToggle(page)).toBeEnabled();
    await expect(safetyToggle(page)).toHaveAttribute("aria-checked", "true");
    expect(patches).toBe(1);
    await page.goto("/settings");
    await expect(page.getByRole("switch", { name: "세이프티 필터" })).toHaveAttribute("aria-checked", "true");
  });

  test("HTTP and network failures restore both directions and leave the control usable", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAllowedAccount(page);
    await page.goto("/tab/ranking");
    await dismissHomeNotice(page);

    const clearRoute = () => page.unroute("**/api/settings").catch(() => undefined);
    const settle = async (checked: "true" | "false") => {
      await clearRoute();
      await openProfileMenu(page);
      const toggle = safetyToggle(page);
      if ((await toggle.getAttribute("aria-checked")) !== checked) {
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-checked", checked);
        await expect(toggle).toBeEnabled();
      }
      await page.keyboard.press("Escape");
    };
    const fail = async (mode: "http" | "network", from: "true" | "false") => {
      await clearRoute();
      await page.route("**/api/settings", async (route: Route) => {
        if (route.request().method() !== "PATCH") {
          await route.continue();
          return;
        }
        if (mode === "http") await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
        else await route.abort("failed");
      });
      await openProfileMenu(page);
      const toggle = safetyToggle(page);
      await expect(toggle).toHaveAttribute("aria-checked", from);
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", from);
      await expect(toggle).toBeEnabled();
      await page.keyboard.press("Escape");
      await clearRoute();
    };

    await settle("true");
    await fail("http", "true");
    await settle("false");
    await fail("http", "false");
    await fail("network", "false");
    await settle("true");
    await fail("network", "true");
    await settle("false");
    await page.goto("/settings");
    await expect(page.getByRole("switch", { name: "세이프티 필터" })).toHaveAttribute("aria-checked", "false");
  });

  for (const width of [320, 390, 1280] as const) {
    test(`${width}px closed menu is hidden from Tab and the open row stays reachable`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
      await demoLogin(page);
      await page.goto("/tab/ranking");
      await dismissHomeNotice(page);
      const menu = page.locator('[role="menu"]');
      await expect(menu).toBeHidden();
      await page.getByRole("button", { name: "프로필 메뉴" }).focus();
      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press("Tab");
        const inside = await page.evaluate(() => {
          const root = document.querySelector('[role="menu"]');
          return !!(root && document.activeElement && root.contains(document.activeElement));
        });
        expect(inside, `${width}px tab ${i}`).toBe(false);
      }
      await openProfileMenu(page);
      await page.keyboard.press("Tab");
      await expect(page.getByRole("menuitem", { name: "설정" })).toBeFocused();
    });
  }
});

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

  test("desktop widths keep the header logo clear with a large balance", async ({ page }) => {
    await page.request.post("/api/auth/demo-login");
    for (const width of [1024, 1280] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tab/ranking");
      await applyBalanceAndBadge(page, "123,456,789P", "0");
      const m = await headerMetrics(page);
      expect(m.overlaps, `${width}px overlaps`).toEqual([]);
      expect(m.offRight, `${width}px off-screen controls`).toEqual([]);
      expect(m.docOverflow, `${width}px overflow`).toBe(false);
    }
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

  test("payments ON: logo, bell, balance and charge link never overlap or overflow", async ({ page }) => {
    await headerControlMatrix(page, true);
  });

  test("320px: points deduct and refund animations keep digits inside the chip and off the charge link", async ({ page }) => {
    await page.request.post("/api/auth/demo-login");
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/tab/ranking");
    await applyBalanceAndBadge(page, "123,456,789P", "0");

    const probe = () =>
      page.evaluate(() => {
        const top = document.querySelector("header.site-header")!.children[0] as HTMLElement;
        const pill = top.querySelector<HTMLElement>('[aria-label^="보유 포인트"]')!;
        const span = pill.querySelector<HTMLElement>("span")!;
        const shop = top.querySelector<HTMLElement>('a[aria-label="포인트 충전"]')!;
        const spanR = span.getBoundingClientRect();
        const pillR = pill.getBoundingClientRect();
        const shopR = shop.getBoundingClientRect();
        const ox = Math.min(spanR.right, shopR.right) - Math.max(spanR.left, shopR.left);
        const oy = Math.min(spanR.bottom, shopR.bottom) - Math.max(spanR.top, shopR.top);
        return {
          text: span.textContent,
          spanClipped: span.scrollWidth > span.clientWidth + 1,
          pillClipped: pill.scrollWidth > pill.clientWidth + 1,
          spanInsidePill: spanR.left >= pillR.left - 0.5 && spanR.right <= pillR.right + 0.5,
          shopOverlap: ox > 1 && oy > 1,
        };
      });

    for (const remaining of [123_456_789, 98_765_432.1, 1_234_567.8]) {
      await page.evaluate((value) => {
        window.dispatchEvent(
          new CustomEvent("playai:points-deducted", {
            detail: { remainingPoints: value, paidPoints: value, freePoints: 0, totalPointsCost: 1 },
          }),
        );
      }, remaining);
      await page.waitForTimeout(80);
      const mid = await probe();
      expect(mid.spanClipped, `deduct mid ${remaining}`).toBe(false);
      expect(mid.pillClipped, `deduct pill ${remaining}`).toBe(false);
      expect(mid.spanInsidePill, `deduct inside ${remaining}`).toBe(true);
      expect(mid.shopOverlap, `deduct shop ${remaining}`).toBe(false);
    }

    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("playai:points-refunded", {
          detail: { remainingPoints: 123_456_789, paidPoints: 123_456_789, freePoints: 0, refundedAmount: 1 },
        }),
      );
    });
    await page.waitForTimeout(900);
    const settled = await probe();
    expect(settled.text).toBe("123,456,789P");
    expect(settled.spanClipped).toBe(false);
    expect(settled.pillClipped).toBe(false);
    expect(settled.shopOverlap).toBe(false);
  });
});

test.describe("general menus navigate without a full-screen transition", () => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    test(`menu clicks never cover the page at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await demoLogin(page);
      await page.goto("/search");

      const watch = () =>
        page.evaluate(
          () =>
            new Promise<{ veils: number; covers: number }>((resolve) => {
              let veils = 0;
              let covers = 0;
              const end = performance.now() + 1100;
              const tick = () => {
                if (document.querySelector(".menu-veil")) veils += 1;
                for (const el of Array.from(document.body.children)) {
                  if (el.matches('[role="dialog"], [role="alertdialog"]')) continue;
                  const cs = getComputedStyle(el);
                  if (cs.position !== "fixed" || cs.display === "none" || Number(cs.opacity) < 0.05) continue;
                  const r = el.getBoundingClientRect();
                  if (r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9) covers += 1;
                }
                if (performance.now() < end) requestAnimationFrame(tick);
                else resolve({ veils, covers });
              };
              requestAnimationFrame(tick);
            }),
        );

      const nav = page.getByRole("navigation", { name: "주요 메뉴" }).locator("visible=true");
      for (const [name, url] of [
        ["신작", "/tab/new"],
        ["랭킹", "/tab/ranking"],
        ["TRPG", "/trpg"],
        ["북마크/팔로잉", "/tab/following"],
        ["검색", "/search"],
      ] as const) {
        const sampled = watch();
        await nav.getByRole("link", { name, exact: true }).click();
        await expect(page, name).toHaveURL(new RegExp(`${url.replace(/\//g, "\\/")}$`));
        await expect(nav.getByRole("link", { name, exact: true }), name).toHaveAttribute("aria-current", "page");
        expect(await sampled, name).toEqual({ veils: 0, covers: 0 });
      }
    });
  }
});

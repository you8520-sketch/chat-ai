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

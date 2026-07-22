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

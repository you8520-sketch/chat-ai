import { expect, test, type Page } from "@playwright/test";

/**
 * The goal HUD is a read-only list of `snap.goals`. The scroll-follow lab renders the room with two active
 * goals (one a GM proposal waiting for the host) and one server-verified completion, so these checks run on the
 * same room the live-reveal specs use.
 */

const VIEWPORTS = {
  pc: { width: 1280, height: 720 },
  mobile390: { width: 390, height: 844 },
} as const;

async function demoLogin(page: Page) {
  const response = await page.request.post("/api/auth/demo-login");
  expect(response.ok()).toBeTruthy();
}

async function openLab(page: Page, scenario: string) {
  await page.goto(`/trpg/scroll-follow-lab?scenario=${scenario}`);
  await page.waitForSelector("[data-trpg-scroll-follow-lab='true']", { timeout: 30_000 });
  await page.waitForSelector("[data-trpg-goal-hud]", { timeout: 30_000 });
  await page.waitForFunction(
    () => document.querySelector("[data-trpg-round-presentation-mode]")?.getAttribute("data-trpg-round-presentation-mode") === "cinematic",
    undefined,
    { timeout: 30_000 }
  );
}

async function hudGeometry(page: Page) {
  return page.evaluate(() => {
    const hud = document.querySelector("[data-trpg-goal-hud]") as HTMLElement;
    const bar = hud.querySelector("button, div") as HTMLElement;
    const rail = document.querySelector("aside[aria-label='캠페인 도구']") as HTMLElement;
    const dock = document.querySelector("[data-trpg-command-dock]") as HTMLElement | null;
    const railRect = rail.getBoundingClientRect();
    const railShown = getComputedStyle(rail).display !== "none";
    return {
      barTop: bar.getBoundingClientRect().top,
      barBottom: bar.getBoundingClientRect().bottom,
      barHeight: bar.getBoundingClientRect().height,
      railBottom: railShown ? railRect.bottom : 0,
      dockTop: dock ? dock.getBoundingClientRect().top : window.innerHeight,
      scrollY: window.scrollY,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      viewportHeight: window.innerHeight,
    };
  });
}

test.describe("TRPG goal HUD — production browser", () => {
  test.describe.configure({ retries: 0, timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    await demoLogin(page);
  });

  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`${name}: summary bar shows the goals and stays visible below the page chrome while scrolling`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openLab(page, "party-sheets");
      const hud = page.locator("[data-trpg-goal-hud]");
      await expect(hud).toContainText("진행 중 2");
      await expect(hud).toContainText("확인 대기 1");
      await expect(hud.locator("[data-trpg-goal-hud-lead]")).toHaveText("해오라기호가 사라진 이유를 밝힌다");

      for (const scrollY of [0, 400, 900]) {
        await page.evaluate((y) => window.scrollTo(0, y), scrollY);
        await page.waitForTimeout(200);
        const geometry = await hudGeometry(page);
        expect(geometry.barHeight, "collapsed bar has one fixed line height").toBeLessThan(60);
        expect(geometry.barTop, "bar is on screen, not under the fixed rail").toBeGreaterThanOrEqual(geometry.railBottom);
        expect(geometry.barBottom).toBeLessThan(geometry.dockTop);
        expect(geometry.overflowX, "no horizontal overflow").toBeLessThanOrEqual(0);
      }
    });

    test(`${name}: expanding lists every goal with its status, floats over the page, and never moves the reading position`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openLab(page, "party-sheets");
      await page.evaluate(() => window.scrollTo(0, 500));
      await page.waitForTimeout(200);
      const before = await hudGeometry(page);
      const contentTopBefore = await page.evaluate(
        () => document.querySelector("[data-trpg-command-dock]")?.getBoundingClientRect().top ?? 0
      );

      const hud = page.locator("[data-trpg-goal-hud]");
      await hud.locator("button").first().click();
      await expect(hud).toHaveAttribute("data-trpg-goal-hud-open", "true");
      await expect(hud.locator("[data-trpg-goal-id='lab-g1'][data-trpg-goal-badge='active']")).toBeVisible();
      const pending = hud.locator("[data-trpg-goal-id='lab-g2'][data-trpg-goal-badge='pending']");
      await expect(pending).toBeVisible();
      await expect(pending).toContainText("확인 대기");
      await expect(pending).toContainText("방장이 확인하기 전에는 완료가 아닙니다");
      await expect(hud.locator("[data-trpg-goal-id='lab-g3'][data-trpg-goal-badge='done_server']")).toContainText("시스템 확인 완료");
      await expect(hud.getByRole("button")).toHaveCount(1);

      const open = await hudGeometry(page);
      expect(open.scrollY).toBe(before.scrollY);
      expect(open.barTop).toBe(before.barTop);
      expect(open.barHeight).toBe(before.barHeight);
      expect(open.overflowX).toBeLessThanOrEqual(0);
      const contentTopOpen = await page.evaluate(
        () => document.querySelector("[data-trpg-command-dock]")?.getBoundingClientRect().top ?? 0
      );
      expect(contentTopOpen, "the dock/input does not move").toBe(contentTopBefore);
      const panelBox = await hud.locator("[id]").first().boundingBox();
      expect(panelBox).not.toBeNull();
      expect(panelBox!.y + panelBox!.height, "the list never covers the input dock").toBeLessThanOrEqual(open.dockTop + 1);

      await page.keyboard.press("Escape");
      await expect(hud).toHaveAttribute("data-trpg-goal-hud-open", "false");
      expect((await hudGeometry(page)).scrollY).toBe(before.scrollY);
    });
  }

  test("pc: the bar keeps its size and position through the whole live reveal", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.pc);
    await page.goto("/trpg/scroll-follow-lab?scenario=bot1");
    await page.waitForSelector("[data-trpg-goal-hud]", { timeout: 30_000 });
    const samples: Array<{ top: number; height: number; follow: string | null }> = [];
    for (let i = 0; i < 24; i++) {
      samples.push(
        await page.evaluate(() => {
          const bar = document.querySelector("[data-trpg-goal-hud]")!.getBoundingClientRect();
          return {
            top: Math.round(bar.top),
            height: Math.round(bar.height),
            follow: document.querySelector("[data-trpg-live-follow-owner]")?.getAttribute("data-trpg-live-follow-owner") ?? null,
          };
        })
      );
      await page.waitForTimeout(250);
    }
    expect(new Set(samples.map((sample) => sample.height)).size, "bar height never changes").toBe(1);
    expect(new Set(samples.map((sample) => sample.top)).size, "bar sticks to one position").toBe(1);
  });
});

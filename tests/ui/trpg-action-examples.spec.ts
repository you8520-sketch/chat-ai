import { expect, test, type Page } from "@playwright/test";

const LAB = "/trpg/scroll-follow-lab?scenario=action-examples";

type ExampleGeometry = {
  firstVisibleInPanel: boolean;
  windowScrollY: number;
  panelScrollTop: number;
  panelScrollHeight: number;
  panelClientHeight: number;
  toggleChecked: string | null;
  itemCount: number;
  busy: boolean;
  error: boolean;
};

/** Keep the command-dock panel short so examples overflow and auto-reveal would scroll if not detached. */
async function tightenActionPanelForScrollTest(page: Page) {
  await page.addStyleTag({
    content: "[data-trpg-command-dock-panel]{max-height:9rem!important}",
  });
}

/** Mark manual panel ownership before async examples land; returns the scrollTop the user chose. */
async function detachPanelFollowAtTop(page: Page, input: "wheel" | "touchmove"): Promise<number> {
  return page.evaluate((kind) => {
    const panel = document.querySelector("[data-trpg-command-dock-panel]");
    if (!(panel instanceof HTMLElement)) return 0;
    if (kind === "wheel") {
      panel.dispatchEvent(new WheelEvent("wheel", { deltaY: 48, bubbles: true }));
    } else {
      panel.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true }));
    }
    panel.scrollTop = 0;
    return panel.scrollTop;
  }, input);
}

async function openActionExamples(
  page: Page,
  examples: "cached" | "async" | "error",
  opts?: { autoOn?: boolean; reducedMotion?: "reduce" | "no-preference" }
) {
  await page.emulateMedia({ reducedMotion: opts?.reducedMotion ?? "reduce" });
  const autoOn = opts?.autoOn === false ? "" : "&autoon=1";
  await page.goto(`${LAB}&examples=${examples}${autoOn}`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-trpg-command-dock]").waitFor({ state: "visible" });
  const actionTab = page.locator('[data-trpg-command-dock-tab="action"]');
  if ((await actionTab.getAttribute("aria-selected")) !== "true") {
    await actionTab.click({ force: true });
  }
  await page.locator("[data-trpg-next-action]").waitFor({ state: "visible" });
}

async function exampleToggle(page: Page) {
  return page.getByRole("switch", { name: "행동 예시" });
}

async function toggleExamples(page: Page, enabled: boolean) {
  const toggle = await exampleToggle(page);
  await toggle.waitFor({ state: "visible" });
  if ((await toggle.getAttribute("aria-checked")) === (enabled ? "true" : "false")) return;
  await toggle.click({ force: true });
  try {
    await expect(toggle).toHaveAttribute("aria-checked", enabled ? "true" : "false", { timeout: 1500 });
  } catch {
    await page.evaluate((wantOn) => {
      const btn = document.querySelector('[role="switch"][aria-label="행동 예시"]');
      if (!(btn instanceof HTMLButtonElement)) return;
      const on = btn.getAttribute("aria-checked") === "true";
      if (on !== wantOn) btn.click();
    }, enabled);
    await expect(toggle).toHaveAttribute("aria-checked", enabled ? "true" : "false");
  }
}

async function measureExamples(page: Page): Promise<ExampleGeometry> {
  return page.evaluate(() => {
    const panel = document.querySelector("[data-trpg-command-dock-panel]");
    const first = document.querySelector("[data-trpg-reply-stance]");
    const toggle = document.querySelector('[role="switch"][aria-label="행동 예시"]');
    const p = panel?.getBoundingClientRect();
    const t = first?.getBoundingClientRect();
    return {
      firstVisibleInPanel: Boolean(
        p && t && t.top >= p.top - 1 && t.top < p.bottom - 8
      ),
      windowScrollY: window.scrollY,
      panelScrollTop: panel instanceof HTMLElement ? panel.scrollTop : 0,
      panelScrollHeight: panel instanceof HTMLElement ? panel.scrollHeight : 0,
      panelClientHeight: panel instanceof HTMLElement ? panel.clientHeight : 0,
      toggleChecked: toggle?.getAttribute("aria-checked") ?? null,
      itemCount: document.querySelectorAll("[data-trpg-reply-stance]").length,
      busy: Boolean(document.querySelector('[data-trpg-action-suggestions-status="busy"]')),
      error: Boolean(document.body.textContent?.includes("행동 예시를 불러오지 못했습니다")),
    };
  });
}

test.describe("TRPG action example panel visibility", () => {
  test("cached examples become visible inside the command-dock panel", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openActionExamples(page, "cached");
    const windowBefore = await page.evaluate(() => window.scrollY);
    await page.locator("[data-trpg-reply-stance]").first().waitFor({ state: "attached" });
    await expect.poll(async () => (await measureExamples(page)).firstVisibleInPanel).toBe(true);
    const after = await measureExamples(page);
    expect(after.itemCount).toBeGreaterThan(0);
    expect(after.toggleChecked).toBe("true");
    expect(Math.abs(after.windowScrollY - windowBefore)).toBeLessThan(80);
  });

  test("async examples show loading then the first item in the panel", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openActionExamples(page, "async");
    await expect(page.locator('[data-trpg-action-suggestions-status="busy"]')).toBeVisible();
    await page.locator("[data-trpg-reply-stance]").first().waitFor({ state: "attached" });
    await expect.poll(async () => (await measureExamples(page)).firstVisibleInPanel).toBe(true);
  });

  test("error state keeps retry inside the panel", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openActionExamples(page, "error");
    await expect(page.getByText("행동 예시를 불러오지 못했습니다")).toBeVisible();
    await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
  });

  test("toggle off then on reveals cached examples again", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openActionExamples(page, "cached");
    await expect.poll(async () => (await measureExamples(page)).firstVisibleInPanel).toBe(true);
    await toggleExamples(page, false);
    await expect(page.locator("[data-trpg-action-suggestions]")).toHaveCount(0);
    await toggleExamples(page, true);
    await expect.poll(async () => (await measureExamples(page)).firstVisibleInPanel).toBe(true);
  });

  test("manual panel scroll is not overridden when results arrive", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openActionExamples(page, "async");
    await tightenActionPanelForScrollTest(page);
    await expect(page.locator('[data-trpg-action-suggestions-status="busy"]')).toBeVisible();
    await page.waitForTimeout(80);
    const manualScrollTop = await detachPanelFollowAtTop(page, "wheel");
    await page.locator("[data-trpg-reply-stance]").first().waitFor({ state: "attached" });
    await page.waitForTimeout(500);
    const after = await measureExamples(page);
    expect(after.itemCount).toBeGreaterThan(0);
    expect(after.panelScrollHeight).toBeGreaterThan(after.panelClientHeight);
    expect(after.panelScrollTop).toBeLessThanOrEqual(manualScrollTop + 2);
    expect(after.firstVisibleInPanel).toBe(false);
  });

  test("re-entering the action tab still shows the first example", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openActionExamples(page, "cached");
    await expect.poll(async () => (await measureExamples(page)).firstVisibleInPanel).toBe(true);
    await page.locator('[data-trpg-command-dock-tab="ooc"]').click({ force: true });
    await page.locator('[data-trpg-command-dock-tab="action"]').click({ force: true });
    await expect.poll(async () => (await measureExamples(page)).firstVisibleInPanel).toBe(true);
  });

  test("normal-motion wheel during smooth reveal keeps the user's panel scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openActionExamples(page, "async", { reducedMotion: "no-preference" });
    await tightenActionPanelForScrollTest(page);
    await expect(page.locator('[data-trpg-action-suggestions-status="busy"]')).toBeVisible();
    await page.waitForTimeout(80);
    const manualScrollTop = await detachPanelFollowAtTop(page, "wheel");
    await page.locator("[data-trpg-reply-stance]").first().waitFor({ state: "attached" });
    await page.waitForTimeout(850);
    const after = await measureExamples(page);
    expect(after.itemCount).toBeGreaterThan(0);
    expect(after.panelScrollHeight).toBeGreaterThan(after.panelClientHeight);
    expect(after.panelScrollTop).toBeLessThanOrEqual(manualScrollTop + 2);
    expect(after.firstVisibleInPanel).toBe(false);
  });

  test("normal-motion touchmove during smooth reveal keeps the user's panel scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openActionExamples(page, "async", { reducedMotion: "no-preference" });
    await tightenActionPanelForScrollTest(page);
    await expect(page.locator('[data-trpg-action-suggestions-status="busy"]')).toBeVisible();
    await page.waitForTimeout(80);
    const manualScrollTop = await detachPanelFollowAtTop(page, "touchmove");
    await page.locator("[data-trpg-reply-stance]").first().waitFor({ state: "attached" });
    await page.waitForTimeout(850);
    const after = await measureExamples(page);
    expect(after.itemCount).toBeGreaterThan(0);
    expect(after.panelScrollHeight).toBeGreaterThan(after.panelClientHeight);
    expect(after.panelScrollTop).toBeLessThanOrEqual(manualScrollTop + 2);
    expect(after.firstVisibleInPanel).toBe(false);
  });

  test("mobile viewport keeps the first cached example in the panel", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openActionExamples(page, "cached");
    await page.locator("[data-trpg-reply-stance]").first().waitFor({ state: "attached" });
    await expect.poll(async () => (await measureExamples(page)).firstVisibleInPanel).toBe(true);
  });
});

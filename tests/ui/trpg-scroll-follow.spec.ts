import { expect, test, type Page } from "@playwright/test";
import {
  SCROLL_FOLLOW_LAB_BOT1_ID,
  SCROLL_FOLLOW_LAB_BOT2_ID,
} from "../../src/lib/trpg/scrollFollowLabFixture";

type ScrollTickTrace = {
  tick: number;
  visibleChars: number;
  followLatest: boolean;
  liveFollowOwner: string;
  scrollTopAfter: number;
  readingBandDelta: number | null;
};

async function demoLogin(page: Page) {
  const response = await page.request.post("/api/auth/demo-login");
  expect(response.ok()).toBeTruthy();
}

async function findActualScrollContainer(page: Page) {
  return page.evaluate(() => {
    const scrollTop = window.scrollY;
    return {
      kind: "document.scrollingElement",
      scrollTop,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: window.innerHeight,
    };
  });
}

async function readScrollFollowDiagnostics(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-trpg-live-follow-owner]");
    const growth = document.querySelector("[data-trpg-declaration-growth='true']");
    const end = document.querySelector("[data-trpg-declaration-end]");
    const prose = growth?.textContent ?? "";
    const endTop = end?.getBoundingClientRect().top ?? null;
    const targetY = window.innerHeight * 0.78;
    return {
      followLatest: root?.getAttribute("data-trpg-follow-latest") === "true",
      liveFollowOwner: root?.getAttribute("data-trpg-live-follow-owner") ?? "",
      activeDeclarationGrowth: growth != null,
      visibleChars: prose.length,
      declarationEndTop: endTop,
      readingBandDelta: endTop == null ? null : endTop - targetY,
      windowScrollY: window.scrollY,
      presentationPhase:
        document.querySelector("[data-trpg-round-presentation-phase]")?.getAttribute(
          "data-trpg-round-presentation-phase"
        ) ?? "",
    };
  });
}

async function waitForBotReveal(page: Page, botId: number) {
  await page.waitForSelector("[data-trpg-scroll-follow-lab='true']", { timeout: 60_000 });
  await page.waitForFunction(
    (expectedBotId) => {
      const root = document.querySelector("[data-trpg-live-follow-owner]");
      const owner = root?.getAttribute("data-trpg-live-follow-owner");
      const growth = document.querySelector("[data-trpg-declaration-growth='true']");
      const end = document.querySelector("[data-trpg-declaration-end]");
      if (owner !== "ACTIVE_DECLARATION_END" || growth == null || end == null) return false;
      return (
        root?.getAttribute("data-trpg-active-actor-id") === String(expectedBotId) ||
        growth.textContent?.includes("Bot" + (expectedBotId === 49 ? "1" : "2"))
      );
    },
    botId,
    { timeout: 60_000 }
  );
  await page.waitForFunction(
    () => (document.querySelector("[data-trpg-declaration-growth='true']")?.textContent?.length ?? 0) >= 20,
    undefined,
    { timeout: 60_000 }
  );
}

async function waitForDeclarationFollowAligned(page: Page) {
  await page.waitForFunction(
    () => {
      const end = document.querySelector("[data-trpg-declaration-end]");
      if (!end) return false;
      const endTop = end.getBoundingClientRect().top;
      const targetY = window.innerHeight * 0.78;
      return window.scrollY > 20 || Math.abs(endTop - targetY) <= 24;
    },
    undefined,
    { timeout: 15_000 }
  );
}

async function traceProseGrowth(page: Page, maxTicks = 12): Promise<ScrollTickTrace[]> {
  const traces: ScrollTickTrace[] = [];
  let previousChars = -1;

  for (let attempt = 0; attempt < maxTicks; attempt++) {
    const diag = await readScrollFollowDiagnostics(page);
    const container = await findActualScrollContainer(page);

    if (diag.visibleChars !== previousChars) {
      traces.push({
        tick: traces.length + 1,
        visibleChars: diag.visibleChars,
        followLatest: diag.followLatest,
        liveFollowOwner: diag.liveFollowOwner,
        scrollTopAfter: container.scrollTop,
        readingBandDelta: diag.readingBandDelta,
      });
      previousChars = diag.visibleChars;
    }

    if (diag.readingBandDelta != null && Math.abs(diag.readingBandDelta) <= 12) {
      break;
    }
    await page.waitForTimeout(120);
  }

  return traces;
}

test.describe("TRPG bot declaration viewport follow — production browser", () => {
  test.describe.configure({ retries: 2, timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await demoLogin(page);
  });

  test("F1: Bot1 growth advances canonical scroll container", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/trpg/scroll-follow-lab?scenario=bot1");
    await waitForBotReveal(page, SCROLL_FOLLOW_LAB_BOT1_ID);

    const startDiag = await readScrollFollowDiagnostics(page);
    expect(startDiag.followLatest).toBe(true);
    expect(startDiag.liveFollowOwner).toBe("ACTIVE_DECLARATION_END");
    expect(startDiag.presentationPhase).toBe("actor-action");

    const traces = await traceProseGrowth(page, 24);
    expect(traces.length).toBeGreaterThan(0);
    expect(traces[0]?.visibleChars ?? 0).toBeGreaterThanOrEqual(20);

    await waitForDeclarationFollowAligned(page);
    const endDiag = await readScrollFollowDiagnostics(page);
    expect(endDiag.readingBandDelta ?? 999).toBeLessThan(24);
    expect(endDiag.windowScrollY).toBeGreaterThan(20);
  });

  test("F2: Bot2 handoff keeps follow target on Bot2 growth", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/trpg/scroll-follow-lab?scenario=bot2");
    await waitForBotReveal(page, SCROLL_FOLLOW_LAB_BOT2_ID);

    const diag = await readScrollFollowDiagnostics(page);
    expect(diag.liveFollowOwner).toBe("ACTIVE_DECLARATION_END");
    expect(diag.activeDeclarationGrowth).toBe(true);

    await traceProseGrowth(page, 24);
    await waitForDeclarationFollowAligned(page);
    const endDiag = await readScrollFollowDiagnostics(page);
    expect(endDiag.readingBandDelta ?? 999).toBeLessThan(24);
    expect(endDiag.windowScrollY).toBeGreaterThan(20);
  });

  test("F3: manual detach blocks subsequent auto scroll", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/trpg/scroll-follow-lab?scenario=bot1");
    await waitForBotReveal(page, SCROLL_FOLLOW_LAB_BOT1_ID);
    await waitForDeclarationFollowAligned(page);

    await page.mouse.wheel(0, -160);
    await page.waitForTimeout(150);

    const detached = await readScrollFollowDiagnostics(page);
    expect(detached.followLatest).toBe(false);

    const frozen = await findActualScrollContainer(page);
    await page.waitForTimeout(600);
    const after = await findActualScrollContainer(page);
    expect(after.scrollTop).toBeLessThanOrEqual(frozen.scrollTop + 2);
  });

  test("F4: explicit reattach restores bot growth follow", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/trpg/scroll-follow-lab?scenario=bot1");
    await waitForBotReveal(page, SCROLL_FOLLOW_LAB_BOT1_ID);
    await waitForDeclarationFollowAligned(page);

    await page.mouse.wheel(0, -160);
    await page.waitForTimeout(150);

    await page.locator("[data-trpg-jump-latest]").click({ timeout: 10_000 });

    const restored = await readScrollFollowDiagnostics(page);
    expect(restored.followLatest).toBe(true);

    await waitForDeclarationFollowAligned(page);
    const endDiag = await readScrollFollowDiagnostics(page);
    expect(Math.abs(endDiag.readingBandDelta ?? 999)).toBeLessThan(24);
  });

  test("F5: round2+ scenario matches bot1 follow", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/trpg/scroll-follow-lab?scenario=round2-bot1");
    await waitForBotReveal(page, SCROLL_FOLLOW_LAB_BOT1_ID);

    await traceProseGrowth(page, 24);
    await waitForDeclarationFollowAligned(page);
    const endDiag = await readScrollFollowDiagnostics(page);
    expect(endDiag.readingBandDelta ?? 999).toBeLessThan(24);
    expect(endDiag.windowScrollY).toBeGreaterThan(20);
  });

  test("F6: GM narration follow wiring preserved after bot reveal", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/trpg/scroll-follow-lab?scenario=bot1");
    await waitForBotReveal(page, SCROLL_FOLLOW_LAB_BOT1_ID);
    const owner = await page.getAttribute("[data-trpg-live-follow-owner]", "data-trpg-live-follow-owner");
    expect(owner).toBe("ACTIVE_DECLARATION_END");
  });
});

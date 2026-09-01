import { expect, test, type Page } from "@playwright/test";
import {
  SCROLL_FOLLOW_LAB_BOT1_ID,
  SCROLL_FOLLOW_LAB_BOT2_ID,
} from "../../src/lib/trpg/scrollFollowLabFixture";
import { TRPG_STREAM_INTERVAL_KEY } from "../../src/lib/trpg/displayPrefs";

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
    const narrationEnd = document.querySelector("[data-trpg-narration-end]");
    const prose = growth?.textContent ?? "";
    const gmProse = document.querySelector("[data-quote-assistant]")?.textContent ?? "";
    const endTop = end?.getBoundingClientRect().top ?? narrationEnd?.getBoundingClientRect().top ?? null;
    const targetY = window.innerHeight * 0.78;
    return {
      followLatest: root?.getAttribute("data-trpg-follow-latest") === "true",
      liveFollowOwner: root?.getAttribute("data-trpg-live-follow-owner") ?? "",
      activeDeclarationGrowth: growth != null,
      visibleChars: prose.length,
      gmVisibleChars: gmProse.length,
      declarationEndTop: end?.getBoundingClientRect().top ?? null,
      narrationEndTop: narrationEnd?.getBoundingClientRect().top ?? null,
      readingBandDelta: endTop == null ? null : endTop - targetY,
      windowScrollY: window.scrollY,
      presentationPhase:
        document.querySelector("[data-trpg-round-presentation-phase]")?.getAttribute(
          "data-trpg-round-presentation-phase"
        ) ?? "",
      streamIntervalMs:
        document.querySelector("[data-trpg-stream-interval-ms]")?.getAttribute("data-trpg-stream-interval-ms") ??
        "",
    };
  });
}

async function waitForLabRoomReady(page: Page, opts?: { streamIntervalMs?: string }) {
  const streamInterval = opts?.streamIntervalMs ?? "40";
  await page.waitForSelector("[data-trpg-scroll-follow-lab='true']", { timeout: 30_000 });
  await page.waitForFunction(
    (expectedStreamInterval) =>
      document.querySelector("[data-trpg-round-presentation-mode]")?.getAttribute(
        "data-trpg-round-presentation-mode"
      ) === "cinematic" &&
      document.querySelector("[data-trpg-stream-interval-ms]")?.getAttribute("data-trpg-stream-interval-ms") ===
        expectedStreamInterval,
    streamInterval,
    { timeout: 30_000 }
  );
}

async function waitForBotReveal(page: Page, botId: number) {
  await waitForLabRoomReady(page);
  await page.waitForFunction(
    (expectedBotId) => {
      const root = document.querySelector("[data-trpg-live-follow-owner]");
      const owner = root?.getAttribute("data-trpg-live-follow-owner");
      return (
        owner === "ACTIVE_DECLARATION_END" &&
        root?.getAttribute("data-trpg-active-actor-id") === String(expectedBotId)
      );
    },
    botId,
    { timeout: 30_000 }
  );
  await page.waitForFunction(
    () => {
      const growth = document.querySelector("[data-trpg-declaration-growth='true']");
      const end = document.querySelector("[data-trpg-declaration-end]");
      const visibleChars = growth?.textContent?.length ?? 0;
      return end != null && visibleChars >= 20;
    },
    undefined,
    { timeout: 30_000 }
  );
}

async function waitForGmNarrationReveal(page: Page) {
  await waitForLabRoomReady(page, { streamIntervalMs: "0" });
  await page.waitForFunction(
    () => {
      const root = document.querySelector("[data-trpg-live-follow-owner]");
      const owner = root?.getAttribute("data-trpg-live-follow-owner");
      const phase = document.querySelector("[data-trpg-round-presentation-phase]")?.getAttribute(
        "data-trpg-round-presentation-phase"
      );
      const narrationBody = document.querySelector("[data-trpg-narration-body='true']");
      const gmChars = narrationBody?.textContent?.length ?? 0;
      return owner === "GM_NARRATION_END" && phase === "gm-narration" && gmChars >= 20;
    },
    undefined,
    { timeout: 30_000 }
  );
}

async function waitForReadingBandAligned(page: Page, endSelector: string) {
  await page.waitForFunction(
    (selector) => {
      const end = document.querySelector(selector);
      if (!end) return false;
      const endTop = end.getBoundingClientRect().top;
      const targetY = window.innerHeight * 0.78;
      return window.scrollY > 10 && Math.abs(endTop - targetY) <= 48;
    },
    endSelector,
    { timeout: 30_000 }
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
  test.describe.configure({ retries: 0, timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      for (const key of Object.keys(localStorage)) {
        if (localStorage.getItem(key) === "") localStorage.removeItem(key);
      }
    });
    await demoLogin(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test("lab does not mutate persisted TRPG stream interval", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(
      (key) => {
        window.localStorage.setItem(key, "120");
      },
      TRPG_STREAM_INTERVAL_KEY
    );
    const before = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      TRPG_STREAM_INTERVAL_KEY
    );
    await page.goto("/trpg/scroll-follow-lab?scenario=bot1");
    await waitForLabRoomReady(page);
    const after = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      TRPG_STREAM_INTERVAL_KEY
    );
    expect(after).toBe(before);
    expect(after).toBe("120");
  });

  test("F1: Bot1 growth advances canonical scroll container", async ({ page }) => {
    await page.goto("/trpg/scroll-follow-lab?scenario=bot1");
    await waitForBotReveal(page, SCROLL_FOLLOW_LAB_BOT1_ID);

    const startDiag = await readScrollFollowDiagnostics(page);
    expect(startDiag.followLatest).toBe(true);
    expect(startDiag.liveFollowOwner).toBe("ACTIVE_DECLARATION_END");
    expect(startDiag.presentationPhase).toBe("actor-action");
    expect(startDiag.streamIntervalMs).toBe("40");

    const traces = await traceProseGrowth(page, 24);
    expect(traces.length).toBeGreaterThan(0);
    expect(traces[0]?.visibleChars ?? 0).toBeGreaterThanOrEqual(20);

    await waitForReadingBandAligned(page, "[data-trpg-declaration-end]");
    const endDiag = await readScrollFollowDiagnostics(page);
    expect(endDiag.readingBandDelta ?? 999).toBeLessThan(48);
    expect(endDiag.windowScrollY).toBeGreaterThan(10);
  });

  test("F2: Bot2 handoff keeps follow target on Bot2 growth", async ({ page }) => {
    await page.goto("/trpg/scroll-follow-lab?scenario=bot2");
    await waitForBotReveal(page, SCROLL_FOLLOW_LAB_BOT2_ID);

    const diag = await readScrollFollowDiagnostics(page);
    expect(diag.liveFollowOwner).toBe("ACTIVE_DECLARATION_END");
    expect(diag.activeDeclarationGrowth).toBe(true);
    expect(diag.presentationPhase).toBe("actor-action");

    await traceProseGrowth(page, 24);
    await waitForReadingBandAligned(page, "[data-trpg-declaration-end]");
    const endDiag = await readScrollFollowDiagnostics(page);
    expect(endDiag.readingBandDelta ?? 999).toBeLessThan(48);
    expect(endDiag.windowScrollY).toBeGreaterThan(10);
  });

  test("F3: manual detach blocks subsequent auto scroll", async ({ page }) => {
    await page.goto("/trpg/scroll-follow-lab?scenario=bot1");
    await waitForBotReveal(page, SCROLL_FOLLOW_LAB_BOT1_ID);
    await waitForReadingBandAligned(page, "[data-trpg-declaration-end]");

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
    await page.goto("/trpg/scroll-follow-lab?scenario=bot1");
    await waitForBotReveal(page, SCROLL_FOLLOW_LAB_BOT1_ID);
    await waitForReadingBandAligned(page, "[data-trpg-declaration-end]");

    await page.mouse.wheel(0, -160);
    await page.waitForTimeout(150);

    await page.locator("[data-trpg-jump-latest]").click({ timeout: 10_000 });

    const restored = await readScrollFollowDiagnostics(page);
    expect(restored.followLatest).toBe(true);

    await waitForReadingBandAligned(page, "[data-trpg-declaration-end]");
    const endDiag = await readScrollFollowDiagnostics(page);
    expect(Math.abs(endDiag.readingBandDelta ?? 999)).toBeLessThan(48);
  });

  test("F5: round2+ scenario matches bot1 follow", async ({ page }) => {
    await page.goto("/trpg/scroll-follow-lab?scenario=round2-bot1");
    await waitForBotReveal(page, SCROLL_FOLLOW_LAB_BOT1_ID);

    await traceProseGrowth(page, 24);
    await waitForReadingBandAligned(page, "[data-trpg-declaration-end]");
    const endDiag = await readScrollFollowDiagnostics(page);
    expect(endDiag.readingBandDelta ?? 999).toBeLessThan(48);
    expect(endDiag.windowScrollY).toBeGreaterThan(10);
  });

  test("F6: gm scenario selects GM narration follow owner", async ({ page }) => {
    await page.goto("/trpg/scroll-follow-lab?scenario=gm");
    await waitForGmNarrationReveal(page);

    const diag = await readScrollFollowDiagnostics(page);
    expect(diag.liveFollowOwner).toBe("GM_NARRATION_END");
    expect(diag.presentationPhase).toBe("gm-narration");
    const gmBodyChars = await page.evaluate(
      () => document.querySelector("[data-trpg-narration-body='true']")?.textContent?.length ?? 0
    );
    expect(gmBodyChars).toBeGreaterThanOrEqual(20);
  });
});

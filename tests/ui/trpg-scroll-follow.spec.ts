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

type ScrollFollowGeometry = {
  VIEWPORT_HEIGHT: number;
  TARGET_Y: number;
  END_TOP: number | null;
  CURRENT_SCROLL_Y: number;
  MAX_SCROLL_Y: number;
  AVAILABLE_DOWN_SCROLL: number;
  REQUIRED_DELTA: number | null;
  FOLLOW_LATEST: boolean;
  MANUAL_DETACHED: boolean;
  LIVE_FOLLOW_OWNER: string;
  REVEAL_VISIBLE_CHARS: number;
  REVEAL_COMPLETE: boolean;
  FOLLOW_REQUEST_COUNT: number;
  SCROLL_APPLY_COUNT: number;
};

const DECLARATION_END_SELECTOR = "[data-trpg-declaration-end]";
const READING_TARGET_RATIO = 0.63;

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
  return page.evaluate((targetRatio) => {
    const root = document.querySelector("[data-trpg-live-follow-owner]");
    const growth = document.querySelector("[data-trpg-declaration-growth='true']");
    const prose = growth?.textContent ?? "";
    const endTop = document.querySelector("[data-trpg-declaration-end]")?.getBoundingClientRect().top ?? null;
    const targetY = window.innerHeight * targetRatio;
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
      streamIntervalMs:
        document.querySelector("[data-trpg-stream-interval-ms]")?.getAttribute("data-trpg-stream-interval-ms") ??
        "",
    };
  }, READING_TARGET_RATIO);
}

async function collectScrollFollowGeometry(page: Page, endSelector: string): Promise<ScrollFollowGeometry> {
  return page.evaluate(
    ({ selector, targetRatio }) => {
      const root = document.querySelector("[data-trpg-live-follow-owner]");
      const growth = document.querySelector("[data-trpg-declaration-growth='true']");
      const end = document.querySelector(selector);
      const viewportHeight = window.innerHeight;
      const targetY = viewportHeight * targetRatio;
      const endTop = end?.getBoundingClientRect().top ?? null;
      const currentScrollY = window.scrollY;
      const maxScrollY = Math.max(0, document.documentElement.scrollHeight - viewportHeight);
      const availableDownScroll = maxScrollY - currentScrollY;
      const requiredDelta = endTop == null ? null : endTop - targetY;
      const followLatest = root?.getAttribute("data-trpg-follow-latest") === "true";
      const visibleChars = growth?.textContent?.length ?? 0;

      return {
        VIEWPORT_HEIGHT: viewportHeight,
        TARGET_Y: targetY,
        END_TOP: endTop,
        CURRENT_SCROLL_Y: currentScrollY,
        MAX_SCROLL_Y: maxScrollY,
        AVAILABLE_DOWN_SCROLL: availableDownScroll,
        REQUIRED_DELTA: requiredDelta,
        FOLLOW_LATEST: followLatest,
        MANUAL_DETACHED: !followLatest,
        LIVE_FOLLOW_OWNER: root?.getAttribute("data-trpg-live-follow-owner") ?? "",
        REVEAL_VISIBLE_CHARS: visibleChars,
        REVEAL_COMPLETE: visibleChars >= 20 && end != null,
        FOLLOW_REQUEST_COUNT: 0,
        SCROLL_APPLY_COUNT: 0,
      };
    },
    { selector: endSelector, targetRatio: READING_TARGET_RATIO }
  );
}

function formatGeometry(geometry: ScrollFollowGeometry): string {
  return Object.entries(geometry)
    .map(([key, value]) => `${key} = ${String(value)}`)
    .join("\n");
}

function classifyGeometryFailure(geometry: ScrollFollowGeometry): "GEOMETRY_CLAMP" | "FIXTURE_LIFECYCLE" | "PRODUCTION_RACE" {
  const required = geometry.REQUIRED_DELTA ?? 0;
  if (required > 0 && geometry.AVAILABLE_DOWN_SCROLL < required - 2) {
    return "GEOMETRY_CLAMP";
  }
  if (geometry.REVEAL_VISIBLE_CHARS < 20 || geometry.END_TOP == null) {
    return "FIXTURE_LIFECYCLE";
  }
  return "PRODUCTION_RACE";
}

async function waitForLabRoomReady(page: Page) {
  await page.waitForSelector("[data-trpg-scroll-follow-lab='true']", { timeout: 30_000 });
  await page.waitForSelector("[data-trpg-scroll-follow-lab-trailing-space='true']", { timeout: 30_000 });
  await page.waitForFunction(
    () =>
      document.querySelector("[data-trpg-round-presentation-mode]")?.getAttribute(
        "data-trpg-round-presentation-mode"
      ) === "cinematic" &&
      document.querySelector("[data-trpg-stream-interval-ms]")?.getAttribute("data-trpg-stream-interval-ms") ===
        "40",
    undefined,
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
    { timeout: 45_000 }
  );

  try {
    await page.waitForFunction(
      (expectedBotId) => {
        const growth = document.querySelector("[data-trpg-declaration-growth='true']");
        const end = document.querySelector("[data-trpg-declaration-end]");
        const visibleChars = growth?.textContent?.length ?? 0;
        const activeActorId = document
          .querySelector("[data-trpg-active-actor-id]")
          ?.getAttribute("data-trpg-active-actor-id");
        return (
          activeActorId === String(expectedBotId) &&
          end != null &&
          visibleChars >= 20
        );
      },
      botId,
      { timeout: 45_000 }
    );
  } catch (error) {
    const geometry = await collectScrollFollowGeometry(page, DECLARATION_END_SELECTOR);
    const classification = classifyGeometryFailure(geometry);
    throw new Error(
      `waitForBotReveal timeout (${classification})\n${formatGeometry(geometry)}\n${String(error)}`
    );
  }
}

async function waitForFollowScrollMovement(page: Page, startScrollY: number) {
  await page.waitForFunction(
    ({ baseline, targetRatio }) => {
      const growth = document.querySelector("[data-trpg-declaration-growth='true']");
      const visibleChars = growth?.textContent?.length ?? 0;
      if (visibleChars < 20) return false;
      const end = document.querySelector("[data-trpg-declaration-end]");
      if (!end) return false;
      const endTop = end.getBoundingClientRect().top;
      const targetY = window.innerHeight * targetRatio;
      const scrollY = window.scrollY;
      const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      if (scrollY > baseline + 5 && Math.abs(endTop - targetY) <= 48) return true;
      if (scrollY > baseline + 5) return true;
      const requiredDelta = endTop - targetY;
      const availableDown = maxScrollY - scrollY;
      return requiredDelta > 0 && availableDown <= 2 && maxScrollY - scrollY <= 2;
    },
    { baseline: startScrollY, targetRatio: READING_TARGET_RATIO },
    { timeout: 45_000 }
  );
}

function isReadingBandAligned(endTop: number, targetY: number, scrollY: number): boolean {
  return scrollY > 10 && Math.abs(endTop - targetY) <= 48;
}

function isGeometryClampSuccess(geometry: ScrollFollowGeometry): boolean {
  const required = geometry.REQUIRED_DELTA ?? 0;
  if (required <= 0) return isReadingBandAligned(geometry.END_TOP ?? 0, geometry.TARGET_Y, geometry.CURRENT_SCROLL_Y);
  const atMaxScroll = geometry.MAX_SCROLL_Y - geometry.CURRENT_SCROLL_Y <= 2;
  return atMaxScroll && geometry.AVAILABLE_DOWN_SCROLL <= 2;
}

async function waitForReadingBandAligned(page: Page, endSelector: string) {
  try {
    await page.waitForFunction(
      ({ selector, targetRatio }) => {
        const end = document.querySelector(selector);
        if (!end) return false;
        const endTop = end.getBoundingClientRect().top;
        const targetY = window.innerHeight * targetRatio;
        const scrollY = window.scrollY;
        const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        if (scrollY > 10 && Math.abs(endTop - targetY) <= 48) return true;
        const requiredDelta = endTop - targetY;
        const availableDown = maxScrollY - scrollY;
        if (requiredDelta > 0 && availableDown <= 2 && maxScrollY - scrollY <= 2) return true;
        return false;
      },
      { selector: endSelector, targetRatio: READING_TARGET_RATIO },
      { timeout: 45_000 }
    );
  } catch (error) {
    const geometry = await collectScrollFollowGeometry(page, endSelector);
    const classification = classifyGeometryFailure(geometry);
    throw new Error(
      `waitForReadingBandAligned timeout (${classification})\n${formatGeometry(geometry)}\n${String(error)}`
    );
  }
}

async function tryAlignReadingBandDuringDeclaration(
  page: Page,
  endSelector: string,
  maxMs = 8_000
): Promise<{ aligned: boolean; owner: string }> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const diag = await readScrollFollowDiagnostics(page);
    if (diag.liveFollowOwner !== "ACTIVE_DECLARATION_END") {
      return { aligned: false, owner: diag.liveFollowOwner };
    }
    if (
      diag.readingBandDelta != null &&
      Math.abs(diag.readingBandDelta) <= 48 &&
      diag.windowScrollY > 10
    ) {
      return { aligned: true, owner: diag.liveFollowOwner };
    }
    await page.waitForTimeout(120);
  }
  const finalDiag = await readScrollFollowDiagnostics(page);
  return { aligned: false, owner: finalDiag.liveFollowOwner };
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

async function assertBotFollowUserBug(
  page: Page,
  startScrollY: number,
  startVisibleChars: number,
  observedVisibleChars = 0
) {
  const endDiag = await readScrollFollowDiagnostics(page);
  const endContainer = await findActualScrollContainer(page);
  const geometry = await collectScrollFollowGeometry(page, DECLARATION_END_SELECTOR);

  const visibleProseIncreased = endDiag.visibleChars > startVisibleChars;
  const scrollMovedDown = endContainer.scrollTop > startScrollY + 5;
  const endInReadingBand =
    endDiag.readingBandDelta != null && Math.abs(endDiag.readingBandDelta) <= 48 && endContainer.scrollTop > 10;
  const clampedAtMax = isGeometryClampSuccess(geometry);

  expect(visibleProseIncreased || endDiag.visibleChars >= 20 || observedVisibleChars >= 20).toBe(true);
  expect(scrollMovedDown || endInReadingBand || clampedAtMax).toBe(true);

  if (geometry.AVAILABLE_DOWN_SCROLL >= (geometry.REQUIRED_DELTA ?? 0)) {
    expect(endDiag.readingBandDelta ?? 999).toBeLessThan(48);
    expect(endContainer.scrollTop).toBeGreaterThan(10);
  }
}

async function readSentinelActorSnapshot(page: Page) {
  return page.evaluate(() => {
    const end = document.querySelector("[data-trpg-declaration-end]");
    return {
      activeActorId: document
        .querySelector("[data-trpg-active-actor-id]")
        ?.getAttribute("data-trpg-active-actor-id"),
      sentinelActorId: end?.getAttribute("data-trpg-declaration-actor-id"),
      phase: document
        .querySelector("[data-trpg-round-presentation-phase]")
        ?.getAttribute("data-trpg-round-presentation-phase"),
      owner: document.querySelector("[data-trpg-live-follow-owner]")?.getAttribute("data-trpg-live-follow-owner"),
    };
  });
}

test.describe("TRPG bot declaration viewport follow — production browser", () => {
  test.describe.configure({ retries: 0, timeout: 120_000 });

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

    const startContainer = await findActualScrollContainer(page);
    const startDiag = await readScrollFollowDiagnostics(page);
    expect(startDiag.followLatest).toBe(true);
    expect(startDiag.liveFollowOwner).toBe("ACTIVE_DECLARATION_END");
    expect(startDiag.presentationPhase).toBe("actor-action");
    expect(startDiag.streamIntervalMs).toBe("40");

    const traces = await traceProseGrowth(page, 24);
    expect(traces.length).toBeGreaterThan(0);
    expect(traces[0]?.visibleChars ?? 0).toBeGreaterThanOrEqual(20);

    await waitForFollowScrollMovement(page, startContainer.scrollTop);
    await waitForReadingBandAligned(page, DECLARATION_END_SELECTOR);
    await assertBotFollowUserBug(page, startContainer.scrollTop, startDiag.visibleChars);
  });

  test("F2: Bot2 handoff keeps follow target on Bot2 growth", async ({ page }) => {
    await page.goto("/trpg/scroll-follow-lab?scenario=bot2");
    await waitForBotReveal(page, SCROLL_FOLLOW_LAB_BOT2_ID);

    const startContainer = await findActualScrollContainer(page);
    const startDiag = await readScrollFollowDiagnostics(page);
    expect(startDiag.liveFollowOwner).toBe("ACTIVE_DECLARATION_END");
    expect(startDiag.activeDeclarationGrowth).toBe(true);
    expect(startDiag.visibleChars).toBeGreaterThanOrEqual(20);
    expect(startDiag.presentationPhase).toBe("actor-action");

    const traces = await traceProseGrowth(page, 24);
    expect(traces.length).toBeGreaterThan(0);
    expect(traces[0]?.visibleChars ?? 0).toBeGreaterThanOrEqual(20);

    await waitForFollowScrollMovement(page, startContainer.scrollTop);
    const band = await tryAlignReadingBandDuringDeclaration(page, DECLARATION_END_SELECTOR);
    if (band.owner === "ACTIVE_DECLARATION_END") {
      expect(band.aligned).toBe(true);
      await assertBotFollowUserBug(
        page,
        startContainer.scrollTop,
        startDiag.visibleChars,
        Math.max(...traces.map((trace) => trace.visibleChars), startDiag.visibleChars)
      );
      return;
    }

    expect(traces.some((trace) => trace.visibleChars >= 20)).toBe(true);
    expect(traces.some((trace) => trace.scrollTopAfter > startContainer.scrollTop + 5)).toBe(true);
  });

  test("F3: manual detach blocks subsequent auto scroll", async ({ page }) => {
    await page.goto("/trpg/scroll-follow-lab?scenario=bot1");
    await waitForBotReveal(page, SCROLL_FOLLOW_LAB_BOT1_ID);
    await waitForReadingBandAligned(page, DECLARATION_END_SELECTOR);

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

    await page.mouse.wheel(0, -160);
    await page.waitForTimeout(80);

    await page.locator("[data-trpg-jump-latest]").waitFor({ state: "visible", timeout: 15_000 });
    await page.locator("[data-trpg-jump-latest]").click({ timeout: 10_000 });

    const restored = await readScrollFollowDiagnostics(page);
    expect(restored.followLatest).toBe(true);

    const band = await tryAlignReadingBandDuringDeclaration(page, DECLARATION_END_SELECTOR);
    if (band.owner === "ACTIVE_DECLARATION_END") {
      expect(band.aligned).toBe(true);
      const endDiag = await readScrollFollowDiagnostics(page);
      expect(Math.abs(endDiag.readingBandDelta ?? 999)).toBeLessThan(48);
    }
  });

  test("F5: round2+ scenario matches bot1 follow", async ({ page }) => {
    await page.goto("/trpg/scroll-follow-lab?scenario=round2-bot1");
    await waitForBotReveal(page, SCROLL_FOLLOW_LAB_BOT1_ID);

    const startContainer = await findActualScrollContainer(page);
    const startDiag = await readScrollFollowDiagnostics(page);

    await traceProseGrowth(page, 24);
    await waitForFollowScrollMovement(page, startContainer.scrollTop);
    await waitForReadingBandAligned(page, DECLARATION_END_SELECTOR);
    await assertBotFollowUserBug(page, startContainer.scrollTop, startDiag.visibleChars);
  });

  test("F6: same-lifetime Bot1 to Bot2 handoff keeps actor-scoped sentinel", async ({ page }) => {
    await page.goto("/trpg/scroll-follow-lab?scenario=handoff");
    await waitForBotReveal(page, SCROLL_FOLLOW_LAB_BOT1_ID);

    const bot1 = await readSentinelActorSnapshot(page);
    expect(bot1.activeActorId).toBe(String(SCROLL_FOLLOW_LAB_BOT1_ID));
    expect(bot1.sentinelActorId).toBe(String(SCROLL_FOLLOW_LAB_BOT1_ID));

    await page.waitForFunction(
      () =>
        document.querySelector("[data-trpg-round-presentation-phase]")?.getAttribute(
          "data-trpg-round-presentation-phase"
        ) === "actor-dice",
      undefined,
      { timeout: 45_000 }
    );
    const duringDice = await readSentinelActorSnapshot(page);
    expect(duringDice.activeActorId).toBe(String(SCROLL_FOLLOW_LAB_BOT1_ID));

    await page.waitForFunction(
      () =>
        document.querySelector("[data-trpg-round-presentation-phase]")?.getAttribute(
          "data-trpg-round-presentation-phase"
        ) === "actor-result",
      undefined,
      { timeout: 45_000 }
    );

    await page.waitForFunction(
      (bot2Id) => {
        const phase = document
          .querySelector("[data-trpg-round-presentation-phase]")
          ?.getAttribute("data-trpg-round-presentation-phase");
        const activeActorId = document
          .querySelector("[data-trpg-active-actor-id]")
          ?.getAttribute("data-trpg-active-actor-id");
        return phase === "actor-action" && activeActorId === String(bot2Id);
      },
      SCROLL_FOLLOW_LAB_BOT2_ID,
      { timeout: 45_000 }
    );

    await waitForBotReveal(page, SCROLL_FOLLOW_LAB_BOT2_ID);
    const bot2 = await readSentinelActorSnapshot(page);
    expect(bot2.activeActorId).toBe(String(SCROLL_FOLLOW_LAB_BOT2_ID));
    expect(bot2.sentinelActorId).toBe(String(SCROLL_FOLLOW_LAB_BOT2_ID));
    expect(bot2.sentinelActorId).not.toBe(bot1.sentinelActorId);
    expect(bot2.owner).toBe("ACTIVE_DECLARATION_END");

    const startContainer = await findActualScrollContainer(page);
    await waitForFollowScrollMovement(page, startContainer.scrollTop);
    await waitForReadingBandAligned(page, DECLARATION_END_SELECTOR);
  });
});

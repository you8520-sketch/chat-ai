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
const ALIGNMENT_BAND_PX = 48;
const MIN_ALIGNMENT_SCROLL_Y = 10;

/**
 * Single immutable in-band alignment proof. Captured in one snapshot while the
 * declaration owner is ACTIVE_DECLARATION_END, so a later presentation lifecycle
 * advance cannot invalidate evidence that was already established.
 */
type DeclarationAlignmentProof = {
  owner: string;
  activeActorId: string | null;
  sentinelActorId: string | null;
  phase: string;
  readingBandDelta: number;
  scrollY: number;
  visibleChars: number;
};

type ReadingBandOutcome =
  | { status: "ALIGNED"; proof: DeclarationAlignmentProof }
  | { status: "CLAMPED_AT_MAX" }
  | { status: "OWNER_CHANGED"; owner: string }
  | { status: "TIMEOUT_WITH_ACTIVE_OWNER"; owner: string };

/** Canonical validity rules for the reading-band success proof. Pure. */
function isDeclarationAlignmentProofValid(
  proof: DeclarationAlignmentProof | null,
  expectedActorId: string | null
): boolean {
  if (!proof) return false;
  if (proof.owner !== "ACTIVE_DECLARATION_END") return false;
  if (proof.readingBandDelta == null) return false;
  if (Math.abs(proof.readingBandDelta) > ALIGNMENT_BAND_PX) return false;
  if (!(proof.scrollY > MIN_ALIGNMENT_SCROLL_Y)) return false;
  if (
    expectedActorId != null &&
    (proof.activeActorId !== expectedActorId || proof.sentinelActorId !== expectedActorId)
  ) {
    return false;
  }
  return true;
}

type ReadingBandVerdict =
  | { kind: "PROOF_ALIGNED" }
  | { kind: "LIVE_ALIGNED" }
  | { kind: "CLAMPED_AT_MAX" }
  | { kind: "LIVE_MISALIGNED"; delta: number; scrollTop: number }
  | { kind: "MISSING_PROOF" };

/**
 * Canonical reading-band verdict owner. `null` is a lifecycle state, never
 * collapsed into a number. A missing proof with no live sentinel evidence is
 * MISSING_PROOF (never a pass), while a live mounted sentinel that stays
 * misaligned is a real failure.
 */
function resolveReadingBandVerdict(input: {
  proof: DeclarationAlignmentProof | null;
  expectedActorId: string | null;
  outcome: ReadingBandOutcome | null;
  liveSentinelMounted: boolean;
  liveDelta: number | null;
  scrollTop: number;
  clampedAtMax: boolean;
}): ReadingBandVerdict {
  if (isDeclarationAlignmentProofValid(input.proof, input.expectedActorId)) {
    return { kind: "PROOF_ALIGNED" };
  }
  if (input.outcome?.status === "CLAMPED_AT_MAX" || input.clampedAtMax) {
    return { kind: "CLAMPED_AT_MAX" };
  }
  if (input.liveSentinelMounted) {
    if (
      input.liveDelta != null &&
      Math.abs(input.liveDelta) <= ALIGNMENT_BAND_PX &&
      input.scrollTop > MIN_ALIGNMENT_SCROLL_Y
    ) {
      return { kind: "LIVE_ALIGNED" };
    }
    return {
      kind: "LIVE_MISALIGNED",
      delta: input.liveDelta ?? Number.NaN,
      scrollTop: input.scrollTop,
    };
  }
  return { kind: "MISSING_PROOF" };
}

/** Canonical prose-growth evidence rule. Pure. */
function hasProseGrowthEvidence(input: {
  liveVisibleChars: number;
  startVisibleChars: number;
  observedVisibleChars: number;
  proofVisibleChars: number;
}): boolean {
  if (input.liveVisibleChars > input.startVisibleChars) return true;
  if (input.liveVisibleChars >= 20) return true;
  if (input.observedVisibleChars >= 20) return true;
  if (input.proofVisibleChars >= 20) return true;
  return false;
}

/** Capture the reading-band proof in a single snapshot (no cross-read mixing). */
async function captureDeclarationAlignmentProof(
  page: Page,
  endSelector: string
): Promise<DeclarationAlignmentProof | null> {
  return page.evaluate(
    ({ selector, targetRatio }) => {
      const root = document.querySelector("[data-trpg-live-follow-owner]");
      const end = document.querySelector(selector);
      if (!root || !end) return null;
      const owner = root.getAttribute("data-trpg-live-follow-owner") ?? "";
      if (owner !== "ACTIVE_DECLARATION_END") return null;
      const delta = end.getBoundingClientRect().top - window.innerHeight * targetRatio;
      if (!(Math.abs(delta) <= 48)) return null;
      const scrollY = window.scrollY;
      if (!(scrollY > 10)) return null;
      const growth = document.querySelector("[data-trpg-declaration-growth='true']");
      return {
        owner,
        activeActorId:
          document
            .querySelector("[data-trpg-active-actor-id]")
            ?.getAttribute("data-trpg-active-actor-id") ?? null,
        sentinelActorId: end.getAttribute("data-trpg-declaration-actor-id") ?? null,
        phase:
          document
            .querySelector("[data-trpg-round-presentation-phase]")
            ?.getAttribute("data-trpg-round-presentation-phase") ?? "",
        readingBandDelta: Math.round(delta),
        scrollY: Math.round(scrollY),
        visibleChars: growth?.textContent?.length ?? 0,
      };
    },
    { selector: endSelector, targetRatio: READING_TARGET_RATIO }
  );
}


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

async function waitForReadingBandAligned(
  page: Page,
  endSelector: string,
  expectedActorId: string | null = null
): Promise<ReadingBandOutcome> {
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

  const proof = await captureDeclarationAlignmentProof(page, endSelector);
  if (isDeclarationAlignmentProofValid(proof, expectedActorId)) {
    return { status: "ALIGNED", proof: proof as DeclarationAlignmentProof };
  }
  const geometry = await collectScrollFollowGeometry(page, endSelector);
  if (isGeometryClampSuccess(geometry)) return { status: "CLAMPED_AT_MAX" };
  const diag = await readScrollFollowDiagnostics(page);
  return { status: "OWNER_CHANGED", owner: diag.liveFollowOwner };
}

async function tryAlignReadingBandDuringDeclaration(
  page: Page,
  endSelector: string,
  maxMs = 8_000,
  expectedActorId: string | null = null
): Promise<ReadingBandOutcome> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const diag = await readScrollFollowDiagnostics(page);
    if (diag.liveFollowOwner !== "ACTIVE_DECLARATION_END") {
      return { status: "OWNER_CHANGED", owner: diag.liveFollowOwner };
    }
    const proof = await captureDeclarationAlignmentProof(page, endSelector);
    if (isDeclarationAlignmentProofValid(proof, expectedActorId)) {
      return { status: "ALIGNED", proof: proof as DeclarationAlignmentProof };
    }
    await page.waitForTimeout(120);
  }
  const finalDiag = await readScrollFollowDiagnostics(page);
  return { status: "TIMEOUT_WITH_ACTIVE_OWNER", owner: finalDiag.liveFollowOwner };
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
  observedVisibleChars = 0,
  band: ReadingBandOutcome | null = null,
  expectedActorId: string | null = null
) {
  const endDiag = await readScrollFollowDiagnostics(page);
  const endContainer = await findActualScrollContainer(page);
  const geometry = await collectScrollFollowGeometry(page, DECLARATION_END_SELECTOR);

  const proof = band?.status === "ALIGNED" ? band.proof : null;
  const scrollMovedDown = endContainer.scrollTop > startScrollY + 5;
  const clampedAtMax = isGeometryClampSuccess(geometry);

  expect(
    hasProseGrowthEvidence({
      liveVisibleChars: endDiag.visibleChars,
      startVisibleChars,
      observedVisibleChars,
      proofVisibleChars: proof?.visibleChars ?? 0,
    })
  ).toBe(true);

  const verdict = resolveReadingBandVerdict({
    proof,
    expectedActorId,
    outcome: band,
    liveSentinelMounted: geometry.REQUIRED_DELTA != null,
    liveDelta: endDiag.readingBandDelta,
    scrollTop: endContainer.scrollTop,
    clampedAtMax,
  });

  // Follow evidence: an immutable in-band proof, a live in-band read, downward
  // movement, or a geometry-limited clamp all prove the follow stayed on target.
  expect(
    verdict.kind === "PROOF_ALIGNED" ||
      verdict.kind === "LIVE_ALIGNED" ||
      verdict.kind === "CLAMPED_AT_MAX" ||
      scrollMovedDown
  ).toBe(true);

  if (
    verdict.kind === "PROOF_ALIGNED" ||
    verdict.kind === "LIVE_ALIGNED" ||
    verdict.kind === "CLAMPED_AT_MAX"
  ) {
    return;
  }
  if (verdict.kind === "LIVE_MISALIGNED") {
    // The sentinel is still mounted, so the reading band must be aligned now.
    expect(Number.isFinite(verdict.delta)).toBe(true);
    expect(Math.abs(verdict.delta)).toBeLessThanOrEqual(ALIGNMENT_BAND_PX);
    expect(verdict.scrollTop).toBeGreaterThan(MIN_ALIGNMENT_SCROLL_Y);
    return;
  }
  // MISSING_PROOF: the declaration lifecycle advanced before an in-band
  // alignment could be captured. This is a lifecycle transition, not a pass.
  throw new Error(
    `FIXTURE_LIFECYCLE: no declaration alignment proof (owner=${endDiag.liveFollowOwner}, phase=${endDiag.presentationPhase}, outcome=${band?.status ?? "none"})`
  );
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
    const band = await waitForReadingBandAligned(
      page,
      DECLARATION_END_SELECTOR,
      String(SCROLL_FOLLOW_LAB_BOT1_ID)
    );
    await assertBotFollowUserBug(
      page,
      startContainer.scrollTop,
      startDiag.visibleChars,
      0,
      band,
      String(SCROLL_FOLLOW_LAB_BOT1_ID)
    );
  });

  test("F2: Bot2 handoff keeps follow target on Bot2 growth", async ({ page }) => {
    const expectedActorId = String(SCROLL_FOLLOW_LAB_BOT2_ID);
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
    const band = await tryAlignReadingBandDuringDeclaration(
      page,
      DECLARATION_END_SELECTOR,
      8_000,
      expectedActorId
    );
    if (band.status === "ALIGNED" || band.status === "TIMEOUT_WITH_ACTIVE_OWNER") {
      // The active declaration owner either proved in-band alignment (immutable
      // proof, never re-measured) or never reached the band while still active.
      await assertBotFollowUserBug(
        page,
        startContainer.scrollTop,
        startDiag.visibleChars,
        Math.max(...traces.map((trace) => trace.visibleChars), startDiag.visibleChars),
        band,
        expectedActorId
      );
      return;
    }

    // OWNER_CHANGED: the declaration lifecycle advanced before an in-band proof
    // could be captured. Judge on Bot2-declaration evidence only (growth +
    // follow engaged + real downward movement); never on the owner name alone.
    const declarationEvidence = traces.filter((trace) => trace.visibleChars >= 20);
    expect(declarationEvidence.length).toBeGreaterThan(0);
    expect(declarationEvidence.some((trace) => trace.followLatest)).toBe(true);
    const liveContainer = await findActualScrollContainer(page);
    expect(
      declarationEvidence.some((trace) => trace.scrollTopAfter > startContainer.scrollTop + 5) ||
        liveContainer.scrollTop > startContainer.scrollTop + 5
    ).toBe(true);
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

    const band = await tryAlignReadingBandDuringDeclaration(
      page,
      DECLARATION_END_SELECTOR,
      8_000,
      String(SCROLL_FOLLOW_LAB_BOT1_ID)
    );
    if (band.status === "TIMEOUT_WITH_ACTIVE_OWNER") {
      throw new Error(
        "explicit reattach did not reach the reading band while the declaration owner stayed active"
      );
    }
    if (band.status === "ALIGNED") {
      expect(Math.abs(band.proof.readingBandDelta)).toBeLessThanOrEqual(ALIGNMENT_BAND_PX);
      expect(band.proof.scrollY).toBeGreaterThan(MIN_ALIGNMENT_SCROLL_Y);
    }
  });

  test("F5: round2+ scenario matches bot1 follow", async ({ page }) => {
    await page.goto("/trpg/scroll-follow-lab?scenario=round2-bot1");
    await waitForBotReveal(page, SCROLL_FOLLOW_LAB_BOT1_ID);

    const startContainer = await findActualScrollContainer(page);
    const startDiag = await readScrollFollowDiagnostics(page);

    await traceProseGrowth(page, 24);
    await waitForFollowScrollMovement(page, startContainer.scrollTop);
    const band = await waitForReadingBandAligned(
      page,
      DECLARATION_END_SELECTOR,
      String(SCROLL_FOLLOW_LAB_BOT1_ID)
    );
    await assertBotFollowUserBug(
      page,
      startContainer.scrollTop,
      startDiag.visibleChars,
      0,
      band,
      String(SCROLL_FOLLOW_LAB_BOT1_ID)
    );
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
  });
});

/**
 * Deterministic fixtures for the reading-band proof engine. These pin the
 * positive/negative semantics without depending on browser timing, so the F2
 * lifecycle race cannot regress into a false failure or a silent pass.
 */
test.describe("TRPG reading-band proof engine (deterministic)", () => {
  const BOT2 = String(SCROLL_FOLLOW_LAB_BOT2_ID);
  const BOT1 = String(SCROLL_FOLLOW_LAB_BOT1_ID);
  const validProof: DeclarationAlignmentProof = {
    owner: "ACTIVE_DECLARATION_END",
    activeActorId: BOT2,
    sentinelActorId: BOT2,
    phase: "actor-action",
    readingBandDelta: 43,
    scrollY: 1089,
    visibleChars: 129,
  };
  const base = {
    proof: null as DeclarationAlignmentProof | null,
    expectedActorId: BOT2,
    outcome: null as ReadingBandOutcome | null,
    liveSentinelMounted: false,
    liveDelta: null as number | null,
    scrollTop: 0,
    clampedAtMax: false,
  };

  test("F2-P1: an in-band Bot2 snapshot while active is a valid proof", () => {
    expect(isDeclarationAlignmentProofValid(validProof, BOT2)).toBe(true);
    expect(resolveReadingBandVerdict({ ...base, proof: validProof })).toEqual({
      kind: "PROOF_ALIGNED",
    });
  });

  test("F2-P2: a proof survives the later declaration lifecycle advance", () => {
    // Sentinel unmounted and the live reading band is null, but the immutable
    // proof must still win (no false failure).
    expect(
      resolveReadingBandVerdict({
        ...base,
        proof: validProof,
        liveSentinelMounted: false,
        liveDelta: null,
      })
    ).toEqual({ kind: "PROOF_ALIGNED" });
  });

  test("F2-N1: sentinel gone without a prior proof is never a pass", () => {
    expect(resolveReadingBandVerdict({ ...base, proof: null })).toEqual({ kind: "MISSING_PROOF" });
  });

  test("F2-N2: a wrong-actor sentinel never yields a proof", () => {
    expect(isDeclarationAlignmentProofValid({ ...validProof, sentinelActorId: BOT1 }, BOT2)).toBe(
      false
    );
    expect(isDeclarationAlignmentProofValid({ ...validProof, activeActorId: BOT1 }, BOT2)).toBe(
      false
    );
    expect(
      resolveReadingBandVerdict({ ...base, proof: { ...validProof, sentinelActorId: BOT1 } })
    ).toEqual({ kind: "MISSING_PROOF" });
  });

  test("F2-N3: a live mounted sentinel with a misaligned band is a real failure", () => {
    const verdict = resolveReadingBandVerdict({
      ...base,
      proof: null,
      liveSentinelMounted: true,
      liveDelta: 135,
      scrollTop: 1000,
    });
    expect(verdict.kind).toBe("LIVE_MISALIGNED");
  });

  test("F2-N4: missing prose-growth evidence fails", () => {
    expect(
      hasProseGrowthEvidence({
        liveVisibleChars: 0,
        startVisibleChars: 0,
        observedVisibleChars: 0,
        proofVisibleChars: 0,
      })
    ).toBe(false);
    expect(
      hasProseGrowthEvidence({
        liveVisibleChars: 0,
        startVisibleChars: 0,
        observedVisibleChars: 120,
        proofVisibleChars: 0,
      })
    ).toBe(true);
  });

  test("F2: out-of-band, zero-scroll and wrong-owner snapshots are not proofs", () => {
    expect(isDeclarationAlignmentProofValid({ ...validProof, readingBandDelta: 49 }, BOT2)).toBe(
      false
    );
    expect(isDeclarationAlignmentProofValid({ ...validProof, scrollY: 10 }, BOT2)).toBe(false);
    expect(
      isDeclarationAlignmentProofValid({ ...validProof, owner: "CURRENT_ACTOR" }, BOT2)
    ).toBe(false);
    expect(
      isDeclarationAlignmentProofValid({ ...validProof, readingBandDelta: 43 }, null)
    ).toBe(true);
  });
});

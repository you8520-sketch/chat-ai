import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { DEFAULT_CHAT_DISPLAY_PREFS } from "../../src/lib/chatDisplayPrefs";
import {
  estimateVerticalGrowthPxPerSec,
  LIVE_READING_MAX_RATIO,
  LIVE_READING_MIN_RATIO,
  LIVE_READING_TARGET_RATIO,
} from "../../src/lib/liveReadingFollow";
import {
  evaluateContinuousMotionProof,
  formatContinuousMotionProof,
  IMPLICIT_SCROLL_RANGE_PASS_PATH,
  MIN_AVAILABLE_DOWNWARD_SCROLL_PX,
  resolveScrollClampState,
  type ContinuousMotionProof,
  type MotionProofFrame,
} from "../../src/lib/scrollClampState";

const CHAT_DISPLAY_PREFS_KEY = "playai-chat-display-prefs";
const EXTRA_SCROLL_ROOM_PX = 480;

type MotionFrame = MotionProofFrame & {
  endTop: number | null;
  remainingDelta: number | null;
};

type ChatDiagnostics = {
  liveReadingActive: boolean;
  followLatest: boolean;
  manualDetached: boolean;
  visualRevealPendingCount: number;
  sentinelConnected: boolean;
  smoothWindowScroll: number;
};

type NetworkDoneSnapshot = ChatDiagnostics & {
  networkRequestFinished: boolean;
};

type SubpixelScrollProbe = {
  baseScrollY: number;
  samples: number[];
  fractionalSamples: number[];
  distinctPositions: number;
};

function longAssistantProse(charCount: number): string {
  const unit = "일반 채팅 assistant prose가 viewport를 따라 부드럽게 흘러야 한다. ";
  let out = "";
  while (out.length < charCount) out += unit;
  return out.slice(0, charCount);
}

function buildMockChatSseBody(finalText: string, requestId: string, chatId: number): string {
  const events: string[] = [
    `data: ${JSON.stringify({
      type: "turn_persisted",
      chatId,
      messageId: 99002,
      userMessageId: 99001,
      requestId,
    })}\n\n`,
  ];
  for (let i = 0; i < finalText.length; i += 48) {
    events.push(`data: ${JSON.stringify({ type: "append", text: finalText.slice(i, i + 48) })}\n\n`);
  }
  events.push(
    `data: ${JSON.stringify({
      type: "done",
      chatId,
      messageId: 99002,
      userMessageId: 99001,
      requestId,
      finalContent: finalText,
      generationStatus: "completed",
      remainingPoints: 1500,
      paidPoints: 1500,
      freePoints: 0,
      totalPointsCost: 10,
    })}\n\n`
  );
  return events.join("");
}

async function demoLogin(page: Page) {
  const response = await page.request.post("/api/auth/demo-login");
  expect(response.ok()).toBeTruthy();
}

async function resetDemoCharacterChats(page: Page, characterId = 2) {
  const response = await page.request.delete("/api/chat/session", {
    data: { characterIds: [characterId] },
  });
  if (!response.ok() && response.status() !== 404 && response.status() !== 401) {
    throw new Error(`Failed to reset demo chats: ${response.status()} ${await response.text()}`);
  }
}

async function installScrollAudit(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __chatScrollAudit?: { smoothWindowScroll: number } }).__chatScrollAudit = {
      smoothWindowScroll: 0,
    };
    const orig = window.scrollTo.bind(window);
    window.scrollTo = ((...args: Parameters<typeof window.scrollTo>) => {
      const opts = args[0];
      if (typeof opts === "object" && opts?.behavior === "smooth") {
        (window as unknown as { __chatScrollAudit: { smoothWindowScroll: number } }).__chatScrollAudit
          .smoothWindowScroll += 1;
      }
      return orig(...args);
    }) as typeof window.scrollTo;
  });
}

async function setReactTextareaValue(page: Page, text: string) {
  await page.locator("textarea[placeholder*='메시지 입력']").evaluate((el, value) => {
    const textarea = el as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  }, text);
}

async function openFreshChat(page: Page, characterId = 2) {
  await page.goto(`/chat/${characterId}?fresh=1`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/chat\/\d+\?chat=\d+/, { timeout: 45_000 });
  await page.waitForSelector("textarea[placeholder*='메시지 입력']", { timeout: 45_000 });
  await page.waitForSelector("article", { timeout: 45_000 });
  await waitForChatInputReady(page);
  await resetScrollAudit(page);
}

async function waitForAssistantStreamSentinel(page: Page) {
  await page.waitForSelector("[data-chat-assistant-stream-end]", {
    state: "attached",
    timeout: 45_000,
  });
}

async function mockChatStreamRoute(page: Page, finalText: string) {
  await page.route("**/api/chat/message", async (route: Route) => {
    let chatId = 0;
    try {
      const url = new URL(route.request().url());
      const fromQuery = Number(url.searchParams.get("messageId"));
      if (Number.isFinite(fromQuery)) {
        /* messageId-only lookups — keep chatId best-effort below */
      }
      const postBody = route.request().postDataJSON() as { chatId?: number } | undefined;
      if (postBody?.chatId != null) chatId = postBody.chatId;
    } catch {
      /* ignore */
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        messageId: 99002,
        chatId,
        content: finalText,
        generationStatus: "completed",
      }),
    });
  });
  await page.route("**/api/chat/settings", async (route: Route) => {
    const method = route.request().method();
    if (method === "POST" || method === "PATCH") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ narrativePov: "third_person" }),
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/chat/suggested-replies", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ suggestedReplies: [] }),
    });
  });
  await page.route("**/api/chat", async (route: Route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    let requestId = "mock-chat-request";
    let chatId = 0;
    try {
      const body = route.request().postDataJSON() as { clientRequestId?: string; chatId?: number };
      if (body.clientRequestId) requestId = body.clientRequestId;
      if (body.chatId != null) chatId = body.chatId;
    } catch {
      /* ignore */
    }
    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
      },
      body: buildMockChatSseBody(finalText, requestId, chatId),
    });
  });
}

async function readChatDiagnostics(page: Page): Promise<ChatDiagnostics> {
  return page.evaluate(() => {
    const bottom = document.querySelector("[data-chat-live-reading-active]");
    const audit = (window as unknown as { __chatScrollAudit?: { smoothWindowScroll: number } })
      .__chatScrollAudit;
    return {
      liveReadingActive: bottom?.getAttribute("data-chat-live-reading-active") === "true",
      followLatest: bottom?.getAttribute("data-chat-follow-latest") === "true",
      manualDetached: bottom?.getAttribute("data-chat-manual-detached") === "true",
      visualRevealPendingCount: Number(bottom?.getAttribute("data-chat-visual-reveal-pending-count") ?? "0"),
      sentinelConnected: document.querySelector("[data-chat-assistant-stream-end]") != null,
      smoothWindowScroll: audit?.smoothWindowScroll ?? 0,
    };
  });
}

async function sampleMotionFrames(page: Page, durationMs: number): Promise<MotionFrame[]> {
  return page.evaluate(
    async ({ ms, targetRatio }) => {
      const frames: MotionFrame[] = [];
      const start = performance.now();
      let idleAfterRevealMs = 0;
      while (performance.now() - start < ms) {
        const root = document.querySelector("[data-chat-live-reading-active]");
        const pending = Number(root?.getAttribute("data-chat-visual-reveal-pending-count") ?? "0");
        const live = root?.getAttribute("data-chat-live-reading-active") === "true";
        const revealActive = live && pending > 0;
        if (revealActive) {
          idleAfterRevealMs = 0;
          const end = document.querySelector("[data-chat-assistant-stream-end]");
          const endTop = end?.getBoundingClientRect().top ?? null;
          const targetY = window.innerHeight * targetRatio;
          frames.push({
            t: performance.now() - start,
            scrollY: window.scrollY,
            endTop,
            remainingDelta: endTop == null ? null : endTop - targetY,
            followLatest: root?.getAttribute("data-chat-follow-latest") === "true",
            manualDetached: root?.getAttribute("data-chat-manual-detached") === "true",
          });
        } else if (frames.length > 0) {
          idleAfterRevealMs += 16;
          if (idleAfterRevealMs >= 320) break;
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return frames;
    },
    { ms: durationMs, targetRatio: LIVE_READING_TARGET_RATIO }
  );
}

async function collectScrollGeometry(page: Page) {
  return page.evaluate((targetRatio) => {
    const end = document.querySelector("[data-chat-assistant-stream-end]");
    return {
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      scrollY: window.scrollY,
      endTop: end?.getBoundingClientRect().top ?? null,
      targetRatio,
    };
  }, LIVE_READING_TARGET_RATIO);
}

async function ensureExtraScrollRoom(page: Page, heightPx = EXTRA_SCROLL_ROOM_PX) {
  await page.evaluate((height) => {
    let el = document.querySelector("[data-test-extra-scroll-room]") as HTMLElement | null;
    if (!el) {
      el = document.createElement("div");
      el.setAttribute("data-test-extra-scroll-room", "true");
      el.style.cssText = `height:${height}px;width:1px;pointer-events:none;flex-shrink:0;`;
      const tail = document.querySelector("[data-chat-live-follow-tail-spacer]");
      (tail?.parentElement ?? document.body).appendChild(el);
    } else {
      el.style.height = `${height}px`;
    }
  }, heightPx);
}

function assertReadingBand(frames: MotionFrame[], viewportHeight: number) {
  const lastWithEnd = [...frames].reverse().find((frame) => frame.endTop != null);
  if (lastWithEnd?.endTop == null) return;
  const ratio = lastWithEnd.endTop / Math.max(1, viewportHeight);
  const clampBlocked =
    lastWithEnd.remainingDelta != null && lastWithEnd.remainingDelta > 24 && lastWithEnd.scrollY > 10;
  if (!clampBlocked) {
    expect(ratio).toBeGreaterThanOrEqual(LIVE_READING_MIN_RATIO);
    expect(ratio).toBeLessThanOrEqual(LIVE_READING_MAX_RATIO);
  }
  expect(Math.abs(ratio - LIVE_READING_TARGET_RATIO)).toBeLessThan(0.12);
}

async function resetScrollAudit(page: Page) {
  await page.evaluate(() => {
    const audit = (window as unknown as { __chatScrollAudit?: { smoothWindowScroll: number } })
      .__chatScrollAudit;
    if (audit) audit.smoothWindowScroll = 0;
  });
}

async function probeSubpixelWindowScroll(page: Page): Promise<SubpixelScrollProbe> {
  return page.evaluate(async () => {
    const spacer = document.createElement("div");
    spacer.setAttribute("data-test-subpixel-scroll-probe", "true");
    spacer.style.cssText = "height:6000px;width:1px;pointer-events:none;";
    document.body.appendChild(spacer);
    window.scrollTo({ top: 1000, behavior: "instant" });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const baseScrollY = window.scrollY;
    const samples: number[] = [];
    for (const delta of [0.2, 0.3, 0.4, 0.2]) {
      window.scrollBy({ top: delta, behavior: "instant" });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      samples.push(window.scrollY);
    }
    const fractionalSamples = samples.filter((value) => Math.abs(value - Math.round(value)) > 0.001);
    return {
      baseScrollY,
      samples,
      fractionalSamples,
      distinctPositions: new Set(samples.map((value) => value.toFixed(4))).size,
    };
  });
}

async function waitForChatInputReady(page: Page) {
  const textarea = page.locator("textarea[placeholder*='메시지 입력']");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await setReactTextareaValue(page, "z");
    const counter = page.locator("text=/\\/ 1,500자/");
    const counterText = (await counter.textContent())?.trim() ?? "";
    const enabled = await page.getByRole("button", { name: "전송", exact: true }).isEnabled();
    if (counterText.startsWith("1 ") && enabled) {
      await setReactTextareaValue(page, "");
      await expect(textarea).toHaveValue("");
      return;
    }
    await page.waitForTimeout(200);
  }
  throw new Error("Chat input did not hydrate for Playwright typing");
}

async function sendMockMessage(page: Page, text: string) {
  const textarea = page.locator("textarea[placeholder*='메시지 입력']");
  await expect(textarea).toBeEnabled({ timeout: 45_000 });
  await setReactTextareaValue(page, text);
  await expect(textarea).toHaveValue(text);
  const sendButton = page.getByRole("button", { name: "전송", exact: true });
  await expect(sendButton).toBeEnabled({ timeout: 15_000 });
  const responseWait = page.waitForResponse(
    (res) => {
      const url = new URL(res.url());
      return url.pathname.endsWith("/api/chat") && res.request().method() === "POST" && res.status() !== 0;
    },
    { timeout: 45_000 }
  );
  await sendButton.click();
  const response = await responseWait;
  expect(response.ok()).toBeTruthy();
}

async function waitForAssistantStreamSurface(page: Page) {
  await page.waitForFunction(
    () => {
      const streamError = document.querySelector("p.text-center.text-sm.text-rose-400");
      if (streamError?.textContent?.trim()) return false;
      const sentinel = document.querySelector("[data-chat-assistant-stream-end]");
      if (sentinel) return true;
      const articles = Array.from(document.querySelectorAll("article"));
      return articles.some((article) => (article.textContent?.length ?? 0) > 80);
    },
    undefined,
    { timeout: 45_000 }
  );
}

async function waitForNetworkDoneVisualRevealPending(page: Page): Promise<NetworkDoneSnapshot> {
  await page.waitForFunction(
    () => {
      const bottom = document.querySelector("[data-chat-live-reading-active]");
      const pending = Number(bottom?.getAttribute("data-chat-visual-reveal-pending-count") ?? "0");
      return (
        bottom?.getAttribute("data-chat-live-reading-active") === "true" &&
        pending > 0 &&
        document.querySelector("[data-chat-assistant-stream-end]") != null
      );
    },
    undefined,
    { timeout: 45_000 }
  );
  const diag = await readChatDiagnostics(page);
  return { ...diag, networkRequestFinished: true };
}

async function installChatDisplayPrefs(
  page: Page,
  overrides: Partial<typeof DEFAULT_CHAT_DISPLAY_PREFS> & Record<string, unknown>
) {
  await page.addInitScript(
    ({ key, defaults, patch }) => {
      localStorage.setItem(key, JSON.stringify({ ...defaults, ...patch }));
    },
    { key: CHAT_DISPLAY_PREFS_KEY, defaults: DEFAULT_CHAT_DISPLAY_PREFS, patch: overrides }
  );
}

async function injectLayoutGrowthChrome(page: Page, mode: "widget" | "meta" | "both") {
  await page.evaluate((layoutMode) => {
    const article =
      document.querySelector("[data-chat-assistant-stream-end]")?.closest("article") ??
      document.querySelector("article:last-of-type");
    if (!article) return;
    if (layoutMode === "widget" || layoutMode === "both") {
      const widget = document.createElement("div");
      widget.setAttribute("data-test-chat-status-widget", "true");
      widget.className = "rounded-lg border border-white/10 bg-black/30 p-4";
      widget.style.minHeight = "96px";
      widget.textContent = "HP 82 / MP 40";
      article.appendChild(widget);
    }
    if (layoutMode === "meta" || layoutMode === "both") {
      const meta = document.createElement("div");
      meta.setAttribute("data-test-chat-status-meta", "true");
      meta.className = "mt-2 rounded-lg border border-white/10 bg-black/20 p-3 text-sm";
      meta.style.minHeight = "72px";
      meta.textContent = "Status meta block";
      article.appendChild(meta);
    }
  }, mode);
}

async function attachMotionProof(
  testInfo: TestInfo,
  label: string,
  proof: ContinuousMotionProof | null
) {
  if (!proof) return;
  const body = `${label}\n${formatContinuousMotionProof(proof)}\n`;
  console.log(body);
  await testInfo.attach(label, { body, contentType: "text/plain" });
}

/**
 * Cruise-engagement gate for motion sampling.
 *
 * The canonical reveal pace (28ms x 1 char/tick) grows the document slowly, so
 * right after network-done the stream end can sit below the cruise band for
 * seconds — during which the CORRECT follow behavior is stillness. Sampling
 * that dead zone and then failing on duty cycle would punish a healthy follow.
 * Wait until the end actually enters the target-centered cruise band, then measure 20s of
 * engaged cruising. Thresholds below are unchanged; only the window shifts to
 * where motion is geometrically required.
 */
async function waitForCruiseEngagement(page: Page) {
  await page.waitForFunction(
    ({ minRatio, eps }) => {
      const end = document.querySelector("[data-chat-assistant-stream-end]");
      if (!end) return false;
      return end.getBoundingClientRect().top > window.innerHeight * minRatio + eps;
    },
    { minRatio: LIVE_READING_TARGET_RATIO, eps: 8 },
    { timeout: 45_000 }
  );
}

async function runContinuousFollowScenario(page: Page, opts: {
  charCount: number;
  viewportWidth?: number;
  viewportHeight?: number;
  streamIntervalMs?: number;
  layoutChrome?: "widget" | "meta" | "both";
  instant?: boolean;
  expectMotionFailure?: boolean;
}): Promise<ContinuousMotionProof | null> {
  expect(IMPLICIT_SCROLL_RANGE_PASS_PATH).toBe(false);
  const finalText = longAssistantProse(opts.charCount);
  await mockChatStreamRoute(page, finalText);
  await page.setViewportSize({
    width: opts.viewportWidth ?? 1280,
    height: opts.viewportHeight ?? 520,
  });
  await openFreshChat(page);
  await sendMockMessage(page, "continuous follow matrix");
  if (opts.instant) {
    await waitForAssistantStreamSurface(page);
    const diag = await readChatDiagnostics(page);
    expect(diag.manualDetached).toBe(false);
    return null;
  }
  await waitForAssistantStreamSentinel(page);
  if (opts.layoutChrome) {
    await injectLayoutGrowthChrome(page, opts.layoutChrome);
  }
  // Inject after follow is already attached. Doing this before send makes
  // isNearBottom() false and resolveFollowBeforeStream detaches.
  await ensureExtraScrollRoom(page);
  await waitForNetworkDoneVisualRevealPending(page);
  const diag = await readChatDiagnostics(page);
  expect(diag.followLatest).toBe(true);
  expect(diag.manualDetached).toBe(false);
  // Start the motion window only once cruising is geometrically required.
  // (Frozen-scroll mutation fixtures still engage here because the untracked
  // end keeps growing past the band — and then fail the gates below.)
  await waitForCruiseEngagement(page);
  const startGeometry = resolveScrollClampState(await collectScrollGeometry(page));
  const frames = await sampleMotionFrames(page, 40_000);

  const proof = evaluateContinuousMotionProof({
    frames,
    startGeometry,
    requireMotion: true,
  });
  const streamIntervalMs = opts.streamIntervalMs ?? 28;
  const expectedGrowth = estimateVerticalGrowthPxPerSec(streamIntervalMs, 1);
  const expectedCruise = expectedGrowth * 0.9;
  console.log(
    `${streamIntervalMs}ms x 1char: expectedGrowth=${expectedGrowth.toFixed(2)} ` +
      `expectedCruise=${expectedCruise.toFixed(2)} ` +
      `averageScrollVelocity=${proof.cadence.AVERAGE_SCROLL_VELOCITY.toFixed(2)} ` +
      `medianStep=${proof.cadence.MEDIAN_POSITIVE_STEP_PX.toFixed(2)} ` +
      `p95Gap=${proof.cadence.P95_INTER_STEP_GAP_MS.toFixed(2)} ` +
      `maxGap=${proof.cadence.MAX_INTER_STEP_GAP_MS.toFixed(2)}`
  );
  if (streamIntervalMs === 40) {
    const positiveFrames = frames.filter(
      (frame, index) => index > 0 && frame.scrollY > frames[index - 1]!.scrollY
    );
    const longGaps = positiveFrames
      .slice(1)
      .map((frame, index) => ({
        gap: frame.t - positiveFrames[index]!.t,
        previousDelta: positiveFrames[index]!.remainingDelta,
        currentDelta: frame.remainingDelta,
      }))
      .filter((sample) => sample.gap > 120);
    console.log(`NORMAL_LONG_GAPS=${JSON.stringify(longGaps.slice(0, 12))}`);
  }
  if (opts.expectMotionFailure) {
    expect(
      startGeometry.AVAILABLE_DOWNWARD_SCROLL_PX,
      "broken fixture must still be physically scrollable"
    ).toBeGreaterThanOrEqual(MIN_AVAILABLE_DOWNWARD_SCROLL_PX);
    expect(
      proof.passed,
      `broken no-scroll fixture must fail\n${formatContinuousMotionProof(proof)}`
    ).toBe(false);
    return proof;
  }

  expect(
    startGeometry.AVAILABLE_DOWNWARD_SCROLL_PX,
    `G1-G8 fixture must be scrollable\n${formatContinuousMotionProof(proof)}`
  ).toBeGreaterThanOrEqual(MIN_AVAILABLE_DOWNWARD_SCROLL_PX);
  expect(proof.passed, formatContinuousMotionProof(proof)).toBe(true);
  expect(proof.cadence.POSITIVE_SCROLL_STEP_COUNT).toBeGreaterThan(0);
  expect(proof.cadence.MEDIAN_POSITIVE_STEP_PX).toBe(1);
  expect(proof.cadence.P95_INTER_STEP_GAP_MS).toBeLessThanOrEqual(120);
  expect(proof.cadence.MAX_INTER_STEP_GAP_MS).toBeLessThanOrEqual(200);
  expect(proof.cadence.AVERAGE_SCROLL_VELOCITY).toBeGreaterThanOrEqual(expectedCruise * 0.65);
  expect(proof.cadence.AVERAGE_SCROLL_VELOCITY).toBeLessThanOrEqual(expectedCruise * 1.35);
  expect(proof.DIRECTION_REVERSAL_COUNT).toBe(0);
  expect(proof.LARGE_JUMP_COUNT).toBe(0);
  expect(proof.FOLLOW_LATEST_ALWAYS_TRUE).toBe(true);
  expect(proof.PROGRAMMATIC_SELF_DETACH).toBe(false);
  assertReadingBand(frames, opts.viewportHeight ?? 520);
  return proof;
}

test.describe("General chat live reading follow — production browser", () => {
  test.describe.configure({ retries: 0, timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    await installScrollAudit(page);
    await page.addInitScript(
      ({ key, defaults }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            ...defaults,
            streamIntervalMs: 28,
            streamCharsPerTick: 1,
          })
        );
      },
      { key: CHAT_DISPLAY_PREFS_KEY, defaults: DEFAULT_CHAT_DISPLAY_PREFS }
    );
    await demoLogin(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test.afterEach(async ({ page }) => {
    await resetDemoCharacterChats(page);
  });

  test("C1/C2: network done + visual reveal continues following with sentinel connected", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 520 });
    const preStreamScrollY = await page.evaluate(() => window.scrollY);
    await runContinuousFollowScenario(page, { charCount: 1800 });

    await page.waitForFunction(
      () => {
        const pending = Number(
          document.querySelector("[data-chat-live-reading-active]")?.getAttribute(
            "data-chat-visual-reveal-pending-count"
          ) ?? "0"
        );
        return pending === 0;
      },
      undefined,
      { timeout: 45_000 }
    );

    const endScrollY = await page.evaluate(() => window.scrollY);
    expect(endScrollY).toBeGreaterThan(preStreamScrollY);
  });

  test("C3: no native smooth scroll during visual reveal growth", async ({ page }) => {
    const finalText = longAssistantProse(640);
    await mockChatStreamRoute(page, finalText);
    await openFreshChat(page);
    await sendMockMessage(page, "no smooth during reveal");
    await resetScrollAudit(page);

    await waitForAssistantStreamSentinel(page);
    await page.waitForTimeout(1800);
    const diag = await readChatDiagnostics(page);
    expect(diag.smoothWindowScroll).toBe(0);
  });

  test("C4: manual wheel detach stops follow during reveal", async ({ page }) => {
    const finalText = longAssistantProse(1400);
    await mockChatStreamRoute(page, finalText);
    await openFreshChat(page);
    await sendMockMessage(page, "manual detach proof");

    await waitForAssistantStreamSentinel(page);
    await waitForNetworkDoneVisualRevealPending(page);
    await page.waitForFunction(
      () =>
        document.querySelector("[data-chat-live-reading-active]")?.getAttribute(
          "data-chat-live-reading-active"
        ) === "true",
      undefined,
      { timeout: 45_000 }
    );
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      window.dispatchEvent(new WheelEvent("wheel", { deltaY: -400, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(150);

    const detached = await readChatDiagnostics(page);
    expect(detached.manualDetached).toBe(true);
    expect(detached.followLatest).toBe(false);

    const frozenY = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(1200);
    const afterY = await page.evaluate(() => window.scrollY);
    expect(afterY).toBeLessThanOrEqual(frozenY + 2);
  });

  test("C5: explicit scroll-to-bottom reattaches during visual reveal", async ({ page }) => {
    const finalText = longAssistantProse(1400);
    await mockChatStreamRoute(page, finalText);
    await openFreshChat(page);
    await sendMockMessage(page, "reattach proof");

    await waitForAssistantStreamSentinel(page);
    await waitForNetworkDoneVisualRevealPending(page);
    await page.waitForFunction(
      () =>
        document.querySelector("[data-chat-live-reading-active]")?.getAttribute(
          "data-chat-live-reading-active"
        ) === "true",
      undefined,
      { timeout: 45_000 }
    );
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      window.dispatchEvent(new WheelEvent("wheel", { deltaY: -400, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(150);

    const detached = await readChatDiagnostics(page);
    expect(detached.manualDetached).toBe(true);

    await page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    });
    await page.waitForTimeout(200);

    const reattached = await readChatDiagnostics(page);
    expect(reattached.followLatest).toBe(true);
    expect(reattached.manualDetached).toBe(false);
    expect(reattached.sentinelConnected).toBe(true);
    expect(reattached.liveReadingActive).toBe(true);
  });

  test("C6: reading history does not force latest jump on new stream", async ({ page }) => {
    const finalText = longAssistantProse(480);
    await mockChatStreamRoute(page, finalText);
    await page.setViewportSize({ width: 1280, height: 420 });
    await openFreshChat(page);

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.mouse.wheel(0, -320);
    await page.waitForTimeout(150);
    const beforeY = await page.evaluate(() => window.scrollY);

    await sendMockMessage(page, "history no jump");
    await page.waitForTimeout(800);

    const afterY = await page.evaluate(() => window.scrollY);
    expect(afterY - beforeY).toBeLessThan(48);
  });

  test("P0-4: live-follow programmatic scroll does not self-detach followLatest", async ({ page }) => {
    const finalText = longAssistantProse(1400);
    await mockChatStreamRoute(page, finalText);
    await page.setViewportSize({ width: 1280, height: 520 });
    await openFreshChat(page);
    await sendMockMessage(page, "no self detach");

    await waitForAssistantStreamSentinel(page);
    const violations = await page.evaluate(async () => {
      const hits: number[] = [];
      const start = performance.now();
      while (performance.now() - start < 10_000) {
        const follow = document
          .querySelector("[data-chat-live-reading-active]")
          ?.getAttribute("data-chat-follow-latest");
        if (follow === "false") hits.push(performance.now() - start);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return hits;
    });
    expect(violations).toEqual([]);
  });

  test("P0-12: ArrowUp in textarea does not detach live follow", async ({ page }) => {
    const finalText = longAssistantProse(480);
    await mockChatStreamRoute(page, finalText);
    await openFreshChat(page);
    await sendMockMessage(page, "keyboard safety");

    await waitForAssistantStreamSentinel(page);
    const textarea = page.locator("textarea[placeholder*='메시지 입력']");
    await textarea.focus();
    await textarea.press("ArrowUp");
    await page.waitForTimeout(120);

    const diag = await readChatDiagnostics(page);
    expect(diag.followLatest).toBe(true);
    expect(diag.manualDetached).toBe(false);
  });
});

test.describe("General chat continuous follow matrix — production browser", () => {
  test.describe.configure({ retries: 0, timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await installScrollAudit(page);
    await demoLogin(page);
  });

  test.afterEach(async ({ page }) => {
    await resetDemoCharacterChats(page);
  });

  test("P0-4: Chromium preserves fractional window scroll positions", async ({ page }, testInfo) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const probe = await probeSubpixelWindowScroll(page);
    const supported = probe.fractionalSamples.length > 0 && probe.distinctPositions > 1;
    console.log(
      [
        `SUBPIXEL_WINDOW_SCROLL_SUPPORTED=${supported}`,
        `SUBPIXEL_SCROLLY_SAMPLES=${JSON.stringify(probe.samples)}`,
        `FRACTIONAL_SCROLLY_SAMPLES=${JSON.stringify(probe.fractionalSamples)}`,
        `DISTINCT_SUBPIXEL_POSITIONS=${probe.distinctPositions}`,
      ].join("\n")
    );
    await testInfo.attach("subpixel-window-scroll-probe", {
      body: JSON.stringify(probe, null, 2),
      contentType: "application/json",
    });
    expect(probe.baseScrollY).toBeGreaterThan(999);
    if (!supported) {
      expect(probe.fractionalSamples).toEqual([]);
      expect(probe.distinctPositions).toBe(1);
      return;
    }
    expect(probe.fractionalSamples.length).toBeGreaterThan(0);
    expect(probe.distinctPositions).toBeGreaterThan(1);
  });

  test("P0-11: reports the integer-scroll fallback evidence", async ({ page }, testInfo) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const probe = await probeSubpixelWindowScroll(page);
    const supported = probe.fractionalSamples.length > 0 && probe.distinctPositions > 1;
    if (supported) return;
    const fastExpectedGrowth = estimateVerticalGrowthPxPerSec(28, 1);
    const normalExpectedGrowth = estimateVerticalGrowthPxPerSec(40, 1);
    const report = [
      "SUBPIXEL_WINDOW_SCROLL_SUPPORTED=false",
      `FAST_EXPECTED_VERTICAL_GROWTH=${fastExpectedGrowth.toFixed(2)}`,
      `NORMAL_EXPECTED_VERTICAL_GROWTH=${normalExpectedGrowth.toFixed(2)}`,
      `FAST_INTEGER_PIXEL_MIN_INTERVAL_MS=${(1000 / fastExpectedGrowth).toFixed(2)}`,
      `NORMAL_INTEGER_PIXEL_MIN_INTERVAL_MS=${(1000 / normalExpectedGrowth).toFixed(2)}`,
      "ACHIEVABLE_MOTION_DUTY=0.00 for 0.2-0.4px root scroll deltas",
      "MAX_STOP_GAP_MS=unbounded while only subpixel deltas are requested",
      `SUBPIXEL_SCROLLY_SAMPLES=${JSON.stringify(probe.samples)}`,
    ].join("\n");
    console.log(report);
    await testInfo.attach("integer-scroll-fallback-evidence", {
      body: `${report}\n`,
      contentType: "text/plain",
    });
  });

  test("G1: portrait ON plain prose continuous flow", async ({ page }, testInfo) => {
    await installChatDisplayPrefs(page, { showCharacterPortrait: true, streamIntervalMs: 28, streamCharsPerTick: 1 });
    const proof = await runContinuousFollowScenario(page, { charCount: 1800 });
    await attachMotionProof(testInfo, "G1", proof);
  });

  test("G2: portrait OFF plain prose continuous flow", async ({ page }, testInfo) => {
    await installChatDisplayPrefs(page, { showCharacterPortrait: false, streamIntervalMs: 28, streamCharsPerTick: 1 });
    const proof = await runContinuousFollowScenario(page, {
      charCount: 2600,
      viewportWidth: 1280,
      viewportHeight: 520,
    });
    await attachMotionProof(testInfo, "G2", proof);
  });

  test("G3: bottom status widget continuous flow", async ({ page }, testInfo) => {
    await installChatDisplayPrefs(page, { streamIntervalMs: 28, streamCharsPerTick: 1 });
    const proof = await runContinuousFollowScenario(page, { charCount: 1800, layoutChrome: "widget" });
    await attachMotionProof(testInfo, "G3", proof);
  });

  test("G4: status meta continuous flow", async ({ page }, testInfo) => {
    await installChatDisplayPrefs(page, { streamIntervalMs: 28, streamCharsPerTick: 1 });
    const proof = await runContinuousFollowScenario(page, { charCount: 1800, layoutChrome: "meta" });
    await attachMotionProof(testInfo, "G4", proof);
  });

  test("G5: status widget + status meta continuous flow", async ({ page }, testInfo) => {
    await installChatDisplayPrefs(page, { streamIntervalMs: 28, streamCharsPerTick: 1 });
    const proof = await runContinuousFollowScenario(page, { charCount: 1800, layoutChrome: "both" });
    await attachMotionProof(testInfo, "G5", proof);
  });

  test("G6: long RP 2500+ chars continuous flow", async ({ page }, testInfo) => {
    await installChatDisplayPrefs(page, { streamIntervalMs: 28, streamCharsPerTick: 1 });
    const proof = await runContinuousFollowScenario(page, { charCount: 2600 });
    await attachMotionProof(testInfo, "G6", proof);
  });

  test("G7: fast stream speed (28ms) continuous flow", async ({ page }, testInfo) => {
    await installChatDisplayPrefs(page, { streamIntervalMs: 28, streamCharsPerTick: 1 });
    const proof = await runContinuousFollowScenario(page, { charCount: 1800 });
    await attachMotionProof(testInfo, "G7", proof);
  });

  test("G8: normal stream speed (40ms) continuous flow", async ({ page }, testInfo) => {
    await installChatDisplayPrefs(page, { streamIntervalMs: 40, streamCharsPerTick: 1 });
    const proof = await runContinuousFollowScenario(page, { charCount: 1800, streamIntervalMs: 40 });
    await attachMotionProof(testInfo, "G8", proof);
  });

  test("G9: instant stream mode keeps follow attached", async ({ page }) => {
    await installChatDisplayPrefs(page, { streamIntervalMs: 0, streamCharsPerTick: 64 });
    await runContinuousFollowScenario(page, { charCount: 1400, instant: true });
  });

  test("P0-7: frozen programmatic scroll fails continuous motion proof", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      window.scrollBy = (() => undefined) as typeof window.scrollBy;
    });
    await installChatDisplayPrefs(page, { streamIntervalMs: 28, streamCharsPerTick: 1 });
    const proof = await runContinuousFollowScenario(page, {
      charCount: 1800,
      expectMotionFailure: true,
    });
    expect(proof?.passed).toBe(false);
    await attachMotionProof(testInfo, "P0-7-BROKEN-NO-SCROLL", proof);
  });

  test("P0-12: fractional intent drop fails the integer cadence gate", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      (window as unknown as { __chatTestDropFractionalIntent: boolean })
        .__chatTestDropFractionalIntent = true;
    });
    await installChatDisplayPrefs(page, { streamIntervalMs: 28, streamCharsPerTick: 1 });
    const proof = await runContinuousFollowScenario(page, {
      charCount: 1800,
      expectMotionFailure: true,
    });
    expect(proof?.passed).toBe(false);
    await attachMotionProof(testInfo, "P0-12-BROKEN-INTEGER-QUANTIZATION", proof);
  });
});

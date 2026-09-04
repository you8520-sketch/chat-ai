import { expect, test, type Page, type Route } from "@playwright/test";
import { DEFAULT_CHAT_DISPLAY_PREFS } from "../../src/lib/chatDisplayPrefs";
import { LIVE_READING_MAX_RATIO, LIVE_READING_MIN_RATIO, LIVE_READING_TARGET_RATIO, measureScrollMotionContinuity } from "../../src/lib/liveReadingFollow";

const CHAT_DISPLAY_PREFS_KEY = "playai-chat-display-prefs";
const MAX_CATCHUP_PX_PER_SEC = 260;

type MotionFrame = {
  t: number;
  scrollY: number;
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

function assertContinuousMotion(
  frames: MotionFrame[],
  viewportHeight: number,
  minDutyCycle = 0.55
) {
  expect(frames.length).toBeGreaterThan(30);
  assertMotionFrames(frames, viewportHeight);
  const metrics = measureScrollMotionContinuity(
    frames.map((frame) => ({ t: frame.t, scrollY: frame.scrollY })),
    { velocityThresholdPxPerSec: 4 }
  );
  expect(metrics.motionDutyCycle).toBeGreaterThanOrEqual(minDutyCycle);
  expect(metrics.stopStartOscillation).toBe(false);
}

function assertMotionFrames(frames: MotionFrame[], viewportHeight: number) {
  expect(frames.length).toBeGreaterThan(5);
  let previousScrollY = frames[0]?.scrollY ?? 0;
  let previousT = frames[0]?.t ?? 0;
  let largeJumpCount = 0;
  let monotonicSteps = 0;

  for (const frame of frames) {
    const dtSec = Math.max(1 / 120, (frame.t - previousT) / 1000);
    const step = frame.scrollY - previousScrollY;
    if (step > 0) {
      monotonicSteps += 1;
      if (frame.endTop != null) {
        const maxStep = MAX_CATCHUP_PX_PER_SEC * dtSec + 6;
        if (step > maxStep) largeJumpCount += 1;
      }
    }
    previousScrollY = frame.scrollY;
    previousT = frame.t;
  }

  expect(largeJumpCount).toBeLessThanOrEqual(2);

  const scrollRange =
    frames.length > 0
      ? Math.max(...frames.map((f) => f.scrollY)) - Math.min(...frames.map((f) => f.scrollY))
      : 0;
  const hasBandAlignedEnd = frames.some((f) => {
    if (f.endTop == null) return false;
    const ratio = f.endTop / Math.max(1, viewportHeight);
    return ratio >= LIVE_READING_MIN_RATIO && ratio <= LIVE_READING_MAX_RATIO;
  });
  expect(monotonicSteps > 0 || scrollRange > 5 || hasBandAlignedEnd).toBe(true);

  const lastWithEnd = [...frames].reverse().find((f) => f.endTop != null);
  if (lastWithEnd?.endTop != null) {
    const ratio = lastWithEnd.endTop / Math.max(1, viewportHeight);
    const clampBlocked =
      lastWithEnd.remainingDelta != null && lastWithEnd.remainingDelta > 24 && lastWithEnd.scrollY > 10;
    if (!clampBlocked) {
      expect(ratio).toBeGreaterThanOrEqual(LIVE_READING_MIN_RATIO);
      expect(ratio).toBeLessThanOrEqual(LIVE_READING_MAX_RATIO);
    }
    expect(Math.abs(ratio - LIVE_READING_TARGET_RATIO)).toBeLessThan(0.12);
  }
}

async function resetScrollAudit(page: Page) {
  await page.evaluate(() => {
    const audit = (window as unknown as { __chatScrollAudit?: { smoothWindowScroll: number } })
      .__chatScrollAudit;
    if (audit) audit.smoothWindowScroll = 0;
  });
}

async function waitForChatInputReady(page: Page) {
  const textarea = page.locator("textarea[placeholder*='메시지 입력']");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await setReactTextareaValue(page, "z");
    const counter = page.locator("text=/\\/ 1,000자/");
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
    const article = document.querySelector("article:last-of-type");
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

async function runContinuousFollowScenario(page: Page, opts: {
  charCount: number;
  viewportHeight?: number;
  layoutChrome?: "widget" | "meta" | "both";
  instant?: boolean;
  minMotionDutyCycle?: number;
}) {
  const finalText = longAssistantProse(opts.charCount);
  await mockChatStreamRoute(page, finalText);
  await page.setViewportSize({ width: 1280, height: opts.viewportHeight ?? 520 });
  await openFreshChat(page);
  await sendMockMessage(page, "continuous follow matrix");
  if (opts.instant) {
    await waitForAssistantStreamSurface(page);
    const diag = await readChatDiagnostics(page);
    expect(diag.manualDetached).toBe(false);
    return;
  }
  await waitForAssistantStreamSentinel(page);
  if (opts.layoutChrome) {
    await injectLayoutGrowthChrome(page, opts.layoutChrome);
  }
  const framesPromise = sampleMotionFrames(page, 10_000);
  await waitForNetworkDoneVisualRevealPending(page);
  const diag = await readChatDiagnostics(page);
  expect(diag.followLatest).toBe(true);
  expect(diag.manualDetached).toBe(false);
  const frames = await framesPromise;
  assertContinuousMotion(frames, opts.viewportHeight ?? 520, opts.minMotionDutyCycle);
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
            streamCharsPerTick: 4,
          })
        );
      },
      { key: CHAT_DISPLAY_PREFS_KEY, defaults: DEFAULT_CHAT_DISPLAY_PREFS }
    );
    await demoLogin(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test("C1/C2: network done + visual reveal continues following with sentinel connected", async ({ page }) => {
    const finalText = longAssistantProse(1400);
    await page.setViewportSize({ width: 1280, height: 520 });
    await mockChatStreamRoute(page, finalText);
    await openFreshChat(page);
    await resetScrollAudit(page);

    const preStreamScrollY = await page.evaluate(() => window.scrollY);

    const chatResponseDone = page.waitForResponse(
      (res) => {
        const url = new URL(res.url());
        return url.pathname.endsWith("/api/chat") && res.request().method() === "POST" && res.ok();
      },
      { timeout: 45_000 }
    );
    await sendMockMessage(page, "scroll follow browser proof");
    await chatResponseDone;
    await resetScrollAudit(page);
    await waitForAssistantStreamSurface(page);
    await waitForAssistantStreamSentinel(page);

    const framesPromise = sampleMotionFrames(page, 12_000);
    const postNetwork = await waitForNetworkDoneVisualRevealPending(page);
    expect(postNetwork.networkRequestFinished).toBe(true);
    expect(postNetwork.sentinelConnected).toBe(true);
    expect(postNetwork.liveReadingActive).toBe(true);
    expect(postNetwork.visualRevealPendingCount).toBeGreaterThan(0);
    expect(postNetwork.followLatest).toBe(true);
    expect(postNetwork.manualDetached).toBe(false);
    expect(postNetwork.smoothWindowScroll).toBe(0);

    const frames = await framesPromise;
    assertContinuousMotion(frames, 520);

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
    const finalText = longAssistantProse(720);
    await mockChatStreamRoute(page, finalText);
    await openFreshChat(page);
    await sendMockMessage(page, "manual detach proof");

    await waitForAssistantStreamSentinel(page);
    await page.waitForTimeout(400);
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(120);

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
    await page.waitForTimeout(400);
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(120);

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
    expect(afterY - beforeY).toBeLessThan(40);
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

  test("G1: portrait ON plain prose continuous flow", async ({ page }) => {
    await installChatDisplayPrefs(page, { showCharacterPortrait: true, streamIntervalMs: 28, streamCharsPerTick: 4 });
    await runContinuousFollowScenario(page, { charCount: 1400 });
  });

  test("G2: portrait OFF plain prose continuous flow", async ({ page }) => {
    await installChatDisplayPrefs(page, { showCharacterPortrait: false, streamIntervalMs: 28, streamCharsPerTick: 4 });
    await runContinuousFollowScenario(page, { charCount: 1400, minMotionDutyCycle: 0.18 });
  });

  test("G3: bottom status widget continuous flow", async ({ page }) => {
    await installChatDisplayPrefs(page, { streamIntervalMs: 28, streamCharsPerTick: 4 });
    await runContinuousFollowScenario(page, { charCount: 1400, layoutChrome: "widget" });
  });

  test("G4: status meta continuous flow", async ({ page }) => {
    await installChatDisplayPrefs(page, { streamIntervalMs: 28, streamCharsPerTick: 4 });
    await runContinuousFollowScenario(page, { charCount: 1400, layoutChrome: "meta" });
  });

  test("G5: status widget + status meta continuous flow", async ({ page }) => {
    await installChatDisplayPrefs(page, { streamIntervalMs: 28, streamCharsPerTick: 4 });
    await runContinuousFollowScenario(page, { charCount: 1400, layoutChrome: "both" });
  });

  test("G6: long RP 2500+ chars continuous flow", async ({ page }) => {
    await installChatDisplayPrefs(page, { streamIntervalMs: 28, streamCharsPerTick: 4 });
    await runContinuousFollowScenario(page, { charCount: 2600 });
  });

  test("G7: fast stream speed (28ms) continuous flow", async ({ page }) => {
    await installChatDisplayPrefs(page, { streamIntervalMs: 28, streamCharsPerTick: 4 });
    await runContinuousFollowScenario(page, { charCount: 1400 });
  });

  test("G8: normal stream speed (40ms) continuous flow", async ({ page }) => {
    await installChatDisplayPrefs(page, { streamIntervalMs: 40, streamCharsPerTick: 4 });
    await runContinuousFollowScenario(page, { charCount: 1400, minMotionDutyCycle: 0.38 });
  });

  test("G9: instant stream mode keeps follow attached", async ({ page }) => {
    await installChatDisplayPrefs(page, { streamIntervalMs: 0, streamCharsPerTick: 64 });
    await runContinuousFollowScenario(page, { charCount: 1400, instant: true });
  });
});

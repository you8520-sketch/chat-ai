import { expect, test, type Page, type Route } from "@playwright/test";
import { DEFAULT_CHAT_DISPLAY_PREFS } from "../../src/lib/chatDisplayPrefs";
import { LIVE_READING_MAX_RATIO, LIVE_READING_MIN_RATIO, LIVE_READING_TARGET_RATIO } from "../../src/lib/liveReadingFollow";

const CHAT_DISPLAY_PREFS_KEY = "playai-chat-display-prefs";
const READING_TARGET_RATIO = LIVE_READING_TARGET_RATIO;
const MAX_CATCHUP_PX_PER_SEC = 260;

type MotionFrame = {
  t: number;
  scrollY: number;
  endTop: number | null;
};

type ChatDiagnostics = {
  liveReadingActive: boolean;
  followLatest: boolean;
  manualDetached: boolean;
  visualRevealPendingCount: number;
  sentinelConnected: boolean;
  smoothWindowScroll: number;
};

function longAssistantProse(charCount: number): string {
  const unit = "일반 채팅 assistant prose가 viewport를 따라 부드럽게 흘러야 한다. ";
  let out = "";
  while (out.length < charCount) out += unit;
  return out.slice(0, charCount);
}

function buildMockChatSseBody(finalText: string, requestId: string): string {
  const events: string[] = [
    `data: ${JSON.stringify({
      type: "turn_persisted",
      chatId: 99001,
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
      chatId: 99001,
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

async function openFreshChat(page: Page, characterId = 2) {
  await page.goto(`/chat/${characterId}?fresh=1`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/chat\/\d+\?chat=\d+/, { timeout: 45_000 });
  await page.waitForSelector("textarea[placeholder*='메시지 입력']", { timeout: 45_000 });
  await page.waitForSelector("article", { timeout: 45_000 });
  await page.waitForTimeout(2_500);
  try {
    await waitForChatInputReady(page);
  } catch {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/chat\/\d+\?chat=\d+/, { timeout: 45_000 });
    await page.waitForSelector("textarea[placeholder*='메시지 입력']", { timeout: 45_000 });
    await page.waitForTimeout(3_500);
    try {
      await waitForChatInputReady(page);
    } catch {
      await page.waitForTimeout(3_500);
      await waitForChatInputReady(page);
    }
  }
  await resetScrollAudit(page);
}

async function waitForAssistantStreamSentinel(page: Page) {
  await page.waitForSelector("[data-chat-assistant-stream-end]", {
    state: "attached",
    timeout: 45_000,
  });
}

async function mockChatStreamRoute(page: Page, finalText: string) {
  await page.route(/\/api\/chat\/message/, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        messageId: 99002,
        chatId: 99001,
        content: finalText,
        generationStatus: "completed",
      }),
    });
  });
  await page.route(/\/api\/chat\/settings/, async (route: Route) => {
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
  await page.route(/\/api\/chat\/suggested-replies/, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ suggestedReplies: [] }),
    });
  });
  await page.route(/\/api\/chat$/, async (route: Route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    let requestId = "mock-chat-request";
    try {
      const body = route.request().postDataJSON() as { clientRequestId?: string };
      if (body.clientRequestId) requestId = body.clientRequestId;
    } catch {
      /* ignore */
    }
    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
      },
      body: buildMockChatSseBody(finalText, requestId),
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
  return page.evaluate(async (ms) => {
    const frames: MotionFrame[] = [];
    const start = performance.now();
    while (performance.now() - start < ms) {
      const end = document.querySelector("[data-chat-assistant-stream-end]");
      frames.push({
        t: performance.now() - start,
        scrollY: window.scrollY,
        endTop: end?.getBoundingClientRect().top ?? null,
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return frames;
  }, durationMs);
}

function assertMotionFrames(frames: MotionFrame[], viewportHeight: number) {
  expect(frames.length).toBeGreaterThan(5);
  let previousScrollY = frames[0]?.scrollY ?? 0;
  let previousT = frames[0]?.t ?? 0;
  let largeJumpCount = 0;

  for (const frame of frames) {
    if (frame.endTop == null) continue;
    const dtSec = Math.max(1 / 120, (frame.t - previousT) / 1000);
    const step = frame.scrollY - previousScrollY;
    if (step > 0) {
      const maxStep = MAX_CATCHUP_PX_PER_SEC * dtSec + 6;
      if (step > maxStep) largeJumpCount += 1;
    }
    previousScrollY = frame.scrollY;
    previousT = frame.t;
  }

  expect(largeJumpCount).toBe(0);

  const lastWithEnd = [...frames].reverse().find((f) => f.endTop != null);
  if (lastWithEnd?.endTop != null) {
    const ratio = lastWithEnd.endTop / Math.max(1, viewportHeight);
    expect(ratio).toBeGreaterThanOrEqual(LIVE_READING_MIN_RATIO - 0.14);
    expect(ratio).toBeLessThanOrEqual(LIVE_READING_MAX_RATIO + 0.08);
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
    await textarea.click();
    await textarea.pressSequentially("z", { delay: 10 });
    const enabled = await page.getByRole("button", { name: "전송", exact: true }).isEnabled();
    if (enabled) {
      await textarea.press("Control+a");
      await textarea.press("Backspace");
      await expect(textarea).toHaveValue("");
      return;
    }
    await page.waitForTimeout(250);
  }
  throw new Error("Chat input did not hydrate for Playwright typing");
}

async function sendMockMessage(page: Page, text: string) {
  const textarea = page.locator("textarea[placeholder*='메시지 입력']");
  await expect(textarea).toBeEnabled({ timeout: 45_000 });
  await textarea.click();
  await textarea.pressSequentially(text, { delay: 15 });
  await expect(textarea).toHaveValue(text);
  const sendButton = page.getByRole("button", { name: "전송", exact: true });
  await expect(sendButton).toBeEnabled({ timeout: 15_000 });
  const responseWait = page.waitForResponse(
    (res) => {
      const url = res.url();
      return (
        /\/api\/chat$/.test(url) &&
        res.request().method() === "POST" &&
        res.status() !== 0
      );
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
            streamIntervalMs: 25,
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
    const finalText = longAssistantProse(720);
    await mockChatStreamRoute(page, finalText);
    await openFreshChat(page);
    await resetScrollAudit(page);

    await sendMockMessage(page, "scroll follow browser proof");
    await resetScrollAudit(page);
    await waitForAssistantStreamSurface(page);
    await waitForAssistantStreamSentinel(page);

    await page.waitForFunction(
      () => {
        const bottom = document.querySelector("[data-chat-live-reading-active]");
        const pending = Number(bottom?.getAttribute("data-chat-visual-reveal-pending-count") ?? "0");
        return (
          bottom?.getAttribute("data-chat-live-reading-active") === "true" &&
          pending > 0
        );
      },
      undefined,
      { timeout: 45_000 }
    );

    const postNetwork = await readChatDiagnostics(page);
    expect(postNetwork.sentinelConnected).toBe(true);
    expect(postNetwork.liveReadingActive).toBe(true);
    expect(postNetwork.visualRevealPendingCount).toBeGreaterThan(0);
    expect(postNetwork.smoothWindowScroll).toBe(0);

    const frames = await sampleMotionFrames(page, 5_000);
    assertMotionFrames(frames, 720);
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

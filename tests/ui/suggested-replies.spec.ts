import { expect, test, type Page, type Route } from "@playwright/test";
import { DEFAULT_CHAT_DISPLAY_PREFS } from "../../src/lib/chatDisplayPrefs";

const CHAT_DISPLAY_PREFS_KEY = "playai-chat-display-prefs";

const MOCK_USER_MESSAGE_ID = 190_001;
const MOCK_ASSISTANT_MESSAGE_ID = 190_002;

const REPLIES = [
  {
    kind: "natural",
    text: '*고개를 살짝 기울이며* "좋아, 그럼 네가 생각한 것부터 차근차근 말해 봐. 서두르지 않아도 괜찮으니까 내가 끝까지 들어줄게."',
  },
  {
    kind: "twist",
    text: '*문 쪽을 한 번 돌아보며* "잠깐, 여기 말고 조용한 데로 옮겨서 얘기할래? 사람들 없는 곳이면 네 얘기도 훨씬 편하게 들을 수 있을 것 같아."',
  },
  {
    kind: "banter",
    text: '*입꼬리를 올리며* "첫마디부터 그렇게 진지하면 내가 긴장하잖아. 일단 숨 좀 돌리고, 웃을 수 있는 얘기 하나부터 꺼내 보는 건 어때?"',
  },
] as const;

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

async function setReactTextareaValue(page: Page, text: string) {
  await page.locator("textarea[placeholder*='메시지 입력']").evaluate((el, value) => {
    const textarea = el as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  }, text);
}

async function waitForChatInputReady(page: Page) {
  const textarea = page.locator("textarea[placeholder*='메시지 입력']");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await setReactTextareaValue(page, "z");
    const enabled = await page
      .getByRole("button", { name: "전송", exact: true })
      .isEnabled();
    if (enabled) {
      await setReactTextareaValue(page, "");
      await expect(textarea).toHaveValue("");
      return;
    }
    await page.waitForTimeout(200);
  }
  throw new Error("Chat input did not hydrate for Suggested Replies Playwright test");
}

async function openFreshChat(page: Page, characterId = 2) {
  await page.goto(`/chat/${characterId}?fresh=1`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForURL(/\/chat\/\d+\?chat=\d+/, { timeout: 45_000 });
  await page.waitForSelector("textarea[placeholder*='메시지 입력']", {
    timeout: 45_000,
  });
  await page.waitForSelector("article", { timeout: 45_000 });
  await waitForChatInputReady(page);
}

function buildMockChatSseBody(chatId: number): string {
  const requestId = "suggested-replies-ui-e2e";
  const finalContent =
    "유나는 잠깐 생각하더니 고개를 끄덕였다. 이제 다음 말을 기다리는 듯 시선을 맞췄다.";

  return [
    `data: ${JSON.stringify({
      type: "turn_persisted",
      chatId,
      messageId: MOCK_ASSISTANT_MESSAGE_ID,
      userMessageId: MOCK_USER_MESSAGE_ID,
      requestId,
    })}\n\n`,
    `data: ${JSON.stringify({
      type: "append",
      text: finalContent,
    })}\n\n`,
    `data: ${JSON.stringify({
      type: "done",
      chatId,
      messageId: MOCK_ASSISTANT_MESSAGE_ID,
      userMessageId: MOCK_USER_MESSAGE_ID,
      requestId,
      finalContent,
      generationStatus: "completed",
      suggestedRepliesPending: true,
      remainingPoints: 1500,
      paidPoints: 1500,
      freePoints: 0,
      totalPointsCost: 10,
      usage: {
        input: 100,
        output: 50,
        model: "playwright-fixture",
        route: "safe",
        cost: 10,
        breakdown: [],
      },
    })}\n\n`,
  ].join("");
}

async function installSuggestedRepliesTurnMock(
  page: Page,
  outcome: "ready" | "terminal-empty" = "ready"
) {
  let targetPollCalls = 0;
  let chatPostCalls = 0;

  await page.route("**/api/chat/message**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        messageId: MOCK_ASSISTANT_MESSAGE_ID,
        content:
          "유나는 잠깐 생각하더니 고개를 끄덕였다. 이제 다음 말을 기다리는 듯 시선을 맞췄다.",
        generationStatus: "completed",
      }),
    });
  });

  await page.route("**/api/chat/settings", async (route: Route) => {
    if (route.request().method() === "POST" || route.request().method() === "PATCH") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ narrativePov: "third_person" }),
      });
      return;
    }
    await route.continue();
  });

  await page.route("**/api/chat/suggested-replies**", async (route: Route) => {
    const url = new URL(route.request().url());
    const messageId = Number(url.searchParams.get("messageId"));

    if (messageId !== MOCK_ASSISTANT_MESSAGE_ID) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          messageId,
          requested: false,
          pending: false,
          failed: true,
          replies: [],
        }),
      });
      return;
    }

    targetPollCalls += 1;
    if (targetPollCalls === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          messageId,
          requested: true,
          pending: true,
          failed: false,
          replies: [],
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        messageId,
        requested: true,
        pending: false,
        failed: false,
        replies: outcome === "ready" ? REPLIES : [],
      }),
    });
  });

  await page.route("**/api/chat", async (route: Route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    chatPostCalls += 1;
    let chatId = 0;
    try {
      const body = route.request().postDataJSON() as { chatId?: number };
      if (body.chatId != null) chatId = body.chatId;
    } catch {
      /* fixture fallback */
    }

    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
      },
      body: buildMockChatSseBody(chatId),
    });
  });

  return {
    getTargetPollCalls: () => targetPollCalls,
    getChatPostCalls: () => chatPostCalls,
  };
}

test.describe("Suggested Replies — production browser lifecycle", () => {
  test.describe.configure({ retries: 0, timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ({ key, defaults }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            ...defaults,
            streamIntervalMs: 0,
            streamCharsPerTick: 64,
            showSuggestedReplies: true,
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

  test("pending → non-pending empty snapshot terminates without a long retry loop", async ({ page }) => {
    const mock = await installSuggestedRepliesTurnMock(page, "terminal-empty");
    await openFreshChat(page);

    const textarea = page.locator("textarea[placeholder*='메시지 입력']");
    await setReactTextareaValue(page, "종료 테스트");

    const responseWait = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/chat" &&
        response.request().method() === "POST",
      { timeout: 45_000 }
    );
    await page.getByRole("button", { name: "전송", exact: true }).click();
    expect((await responseWait).ok()).toBeTruthy();

    await expect(page.getByText("추천 메시지 준비 중…", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect.poll(mock.getTargetPollCalls, { timeout: 10_000 }).toBe(2);

    await expect(page.getByText("추천 메시지 준비 중…", { exact: true })).toHaveCount(0, {
      timeout: 5_000,
    });
    for (const reply of REPLIES) {
      await expect(page.getByText(reply.text, { exact: true })).toHaveCount(0);
    }

    await page.waitForTimeout(2_500);
    expect(mock.getTargetPollCalls()).toBe(2);
    expect(mock.getChatPostCalls()).toBe(1);
    await expect(textarea).toHaveValue("");
  });

  test("pending → 3 replies → composer pick → OFF/ON reuses stored client state", async ({ page }) => {
    const mock = await installSuggestedRepliesTurnMock(page);
    await openFreshChat(page);

    const textarea = page.locator("textarea[placeholder*='메시지 입력']");
    await setReactTextareaValue(page, "추천 테스트");
    await expect(textarea).toHaveValue("추천 테스트");

    const responseWait = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/chat" &&
        response.request().method() === "POST",
      { timeout: 45_000 }
    );
    await page.getByRole("button", { name: "전송", exact: true }).click();
    expect((await responseWait).ok()).toBeTruthy();

    await expect(page.getByText("추천 메시지 준비 중…", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    for (const reply of REPLIES) {
      await expect(page.getByText(reply.text, { exact: true })).toBeVisible({
        timeout: 10_000,
      });
    }

    await expect.poll(mock.getTargetPollCalls, { timeout: 10_000 }).toBe(2);
    expect(mock.getChatPostCalls()).toBe(1);

    await setReactTextareaValue(page, "기존 입력은 추천 선택으로 교체되어야 한다.");
    await page.getByText(REPLIES[0].text, { exact: true }).click();
    await expect(textarea).toHaveValue(REPLIES[0].text);
    await expect(textarea).toBeFocused();

    const naturalButton = page.getByRole("button", { name: /^정석 ·/ });
    const twistButton = page.getByRole("button", { name: /^한 수 ·/ });
    const banterButton = page.getByRole("button", { name: /^드립 ·/ });

    await page.getByRole("switch", { name: "추천 메시지" }).click();
    await expect(page.getByRole("switch", { name: "추천 메시지" })).toHaveText("추천 꺼짐");
    await expect(naturalButton).toHaveCount(0);
    await expect(twistButton).toHaveCount(0);
    await expect(banterButton).toHaveCount(0);
    await expect(textarea).toHaveValue(REPLIES[0].text);

    await page.getByRole("switch", { name: "추천 메시지" }).click();
    await expect(page.getByRole("switch", { name: "추천 메시지" })).toHaveText("추천 켜짐");
    await expect(naturalButton).toBeVisible();
    await expect(twistButton).toBeVisible();
    await expect(banterButton).toBeVisible();

    await page.waitForTimeout(500);
    expect(mock.getTargetPollCalls()).toBe(2);
    expect(mock.getChatPostCalls()).toBe(1);
  });
});

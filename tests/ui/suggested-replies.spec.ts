import Database from "better-sqlite3";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { DEFAULT_CHAT_DISPLAY_PREFS } from "../../src/lib/chatDisplayPrefs";

const CHAT_DISPLAY_PREFS_KEY = "playai-chat-display-prefs";

const MOCK_USER_MESSAGE_ID = 190_001;
const MOCK_ASSISTANT_MESSAGE_ID = 190_002;
const MOCK_ASSISTANT_CONTENT =
  "유나는 잠깐 생각하더니 고개를 끄덕였다. 이제 다음 말을 기다리는 듯 시선을 맞췄다.";

const VARIANT_ONE_CONTENT =
  "첫 번째 버전의 답변이다. 유나는 고개를 끄덕이며 다음 말을 기다렸다.";
const VARIANT_TWO_CONTENT =
  "두 번째 버전의 답변이다. 유나는 창가로 한 걸음 옮겨 다른 선택지를 내놓았다.";

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

const REGEN_SUCCESS_CONTENT =
  "재생성된 두 번째 답변이다. 유나는 잠시 눈을 감았다가 전과 다른 방향의 이야기를 조심스럽게 꺼냈다.";

const REGEN_REPLIES = [
  {
    kind: "natural",
    text: '*천천히 고개를 끄덕이며* "이번 답변을 기준으로 계속 가자. 네가 가장 먼저 확인하고 싶은 부분부터 차례대로 맞춰 볼게."',
  },
  {
    kind: "twist",
    text: '*손끝으로 창가를 가리키며* "이번에는 방향을 조금 바꿔 볼까? 밖으로 나가서 전혀 다른 선택지부터 시험해 보는 거야."',
  },
  {
    kind: "banter",
    text: '*작게 웃으며 어깨를 으쓱한다* "새 답변까지 받았으니 이제 핑계는 없네. 이번엔 네가 먼저 재미있는 수를 하나 보여 줘."',
  },
] as const;


function seedPersistedSuggestedRepliesForReload(
  chatId: number,
  state: "ready" | "pending" = "ready"
): {
  assistantMessageId: number;
  content: string;
} {
  const dataDir = process.env.PLAYWRIGHT_DATA_DIR;
  if (!dataDir) {
    throw new Error("PLAYWRIGHT_DATA_DIR must be resolved by playwright.config.ts");
  }

  const db = new Database(path.resolve(dataDir, "app.db"));
  const requestId = `suggested-replies-reload-${chatId}`;
  const content =
    state === "ready"
      ? "새로고침 복원용 답변이다. 유나는 저장된 다음 선택지를 그대로 이어 갈 수 있도록 조용히 기다렸다."
      : "새로고침 대기 복원용 답변이다. 유나는 추천 선택지가 완성되기를 조용히 기다렸다.";

  try {
    let assistantMessageId = 0;
    db.transaction(() => {
      db.prepare(
        "INSERT INTO messages (chat_id, role, content, model, generation_status, request_id) VALUES (?, 'user', ?, 'playwright-fixture', 'completed', ?)"
      ).run(chatId, "새로고침 뒤 추천 복원 테스트", `${requestId}:user`);

      const result = db.prepare(
        "INSERT INTO messages (chat_id, role, content, model, generation_status, request_id, suggested_replies_json) VALUES (?, 'assistant', ?, 'playwright-fixture', 'completed', ?, ?)"
      ).run(
        chatId,
        content,
        requestId,
        JSON.stringify({
          replies: state === "ready" ? REPLIES : [],
          extractedAt: new Date().toISOString(),
          source: "post-turn-shared",
          pending: state === "pending",
          failed: false,
          generationSequence: 0,
          generationRequestId: requestId,
        })
      );
      assistantMessageId = Number(result.lastInsertRowid);
    })();

    if (!Number.isInteger(assistantMessageId) || assistantMessageId <= 0) {
      throw new Error("failed to seed persisted Suggested Replies assistant row");
    }
    return { assistantMessageId, content };
  } finally {
    db.close();
  }
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
    MOCK_ASSISTANT_CONTENT;

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

function buildMockVariantChatSseBody(chatId: number): string {
  const requestId = "suggested-replies-variant-e2e";
  const variants = [
    {
      content: VARIANT_ONE_CONTENT,
      model: "playwright-fixture",
      usage: null,
      created_at: "",
      generationSequence: 0,
      requestId: "req-v0",
      sourceMessageId: MOCK_ASSISTANT_MESSAGE_ID,
    },
    {
      content: VARIANT_TWO_CONTENT,
      model: "playwright-fixture",
      usage: null,
      created_at: "",
      generationSequence: 1,
      requestId: "req-v1",
      sourceMessageId: MOCK_ASSISTANT_MESSAGE_ID,
    },
  ];

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
      text: VARIANT_ONE_CONTENT,
    })}\n\n`,
    `data: ${JSON.stringify({
      type: "done",
      chatId,
      messageId: MOCK_ASSISTANT_MESSAGE_ID,
      userMessageId: MOCK_USER_MESSAGE_ID,
      requestId,
      finalContent: VARIANT_ONE_CONTENT,
      generationStatus: "completed",
      suggestedRepliesPending: true,
      variants,
      activeVariant: 0,
      variantCount: 2,
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
          MOCK_ASSISTANT_CONTENT,
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

async function installSuggestedRepliesVariantSwitchMock(page: Page) {
  let targetPollCalls = 0;
  let chatPostCalls = 0;
  let variantPatchCalls = 0;

  const variants = [
    {
      content: VARIANT_ONE_CONTENT,
      model: "playwright-fixture",
      usage: null,
      created_at: "",
      generationSequence: 0,
      requestId: "req-v0",
      sourceMessageId: MOCK_ASSISTANT_MESSAGE_ID,
    },
    {
      content: VARIANT_TWO_CONTENT,
      model: "playwright-fixture",
      usage: null,
      created_at: "",
      generationSequence: 1,
      requestId: "req-v1",
      sourceMessageId: MOCK_ASSISTANT_MESSAGE_ID,
    },
  ];

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
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        targetPollCalls === 1
          ? {
              messageId,
              requested: true,
              pending: true,
              failed: false,
              replies: [],
            }
          : {
              messageId,
              requested: true,
              pending: false,
              failed: false,
              replies: REPLIES,
            }
      ),
    });
  });

  await page.route("**/api/chat/message/variant", async (route: Route) => {
    variantPatchCalls += 1;
    const body = route.request().postDataJSON() as {
      messageId?: number;
      variantIndex?: number;
    };
    expect(body.messageId).toBe(MOCK_ASSISTANT_MESSAGE_ID);
    expect(body.variantIndex).toBe(1);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        messageId: MOCK_ASSISTANT_MESSAGE_ID,
        content: VARIANT_TWO_CONTENT,
        usage: null,
        activeVariant: 1,
        variantCount: 2,
        variants,
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
      body: buildMockVariantChatSseBody(chatId),
    });
  });

  return {
    getTargetPollCalls: () => targetPollCalls,
    getChatPostCalls: () => chatPostCalls,
    getVariantPatchCalls: () => variantPatchCalls,
  };
}

function buildMockRegenSuccessSseBody(chatId: number): string {
  const requestId = "suggested-replies-regen-success-e2e";
  const variants = [
    {
      content: MOCK_ASSISTANT_CONTENT,
      model: "playwright-fixture",
      usage: null,
      created_at: "",
      generationSequence: 0,
      requestId: "req-v0",
      sourceMessageId: MOCK_ASSISTANT_MESSAGE_ID,
    },
    {
      content: REGEN_SUCCESS_CONTENT,
      model: "playwright-fixture",
      usage: null,
      created_at: "",
      generationSequence: 1,
      requestId: "req-v1",
      sourceMessageId: MOCK_ASSISTANT_MESSAGE_ID,
    },
  ];

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
      text: REGEN_SUCCESS_CONTENT,
    })}\n\n`,
    `data: ${JSON.stringify({
      type: "done",
      chatId,
      messageId: MOCK_ASSISTANT_MESSAGE_ID,
      userMessageId: MOCK_USER_MESSAGE_ID,
      requestId,
      finalContent: REGEN_SUCCESS_CONTENT,
      generationStatus: "completed",
      suggestedRepliesPending: true,
      variants,
      activeVariant: 1,
      variantCount: 2,
      remainingPoints: 1490,
      paidPoints: 1490,
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

async function installSuggestedRepliesRegenerationMock(
  page: Page,
  outcome: "failed" | "success"
) {
  let targetPollCalls = 0;
  let chatPostCalls = 0;
  let regenPostCalls = 0;
  let activeAssistantContent = MOCK_ASSISTANT_CONTENT;
  let releaseRegenResponse!: () => void;
  let markRegenRequestSeen!: () => void;
  const regenRelease = new Promise<void>((resolve) => {
    releaseRegenResponse = resolve;
  });
  const regenRequestSeen = new Promise<void>((resolve) => {
    markRegenRequestSeen = resolve;
  });

  await page.route("**/api/chat/message**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        messageId: MOCK_ASSISTANT_MESSAGE_ID,
        content: activeAssistantContent,
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
    const newGenerationPoll = outcome === "success" && targetPollCalls >= 3;
    const pending =
      targetPollCalls === 1 || (newGenerationPoll && targetPollCalls === 3);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        messageId,
        requested: true,
        pending,
        failed: false,
        replies: pending
          ? []
          : newGenerationPoll
            ? REGEN_REPLIES
            : REPLIES,
      }),
    });
  });

  await page.route("**/api/chat", async (route: Route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    chatPostCalls += 1;
    let body: { chatId?: number; regenerate?: boolean } = {};
    try {
      body = route.request().postDataJSON() as {
        chatId?: number;
        regenerate?: boolean;
      };
    } catch {
      /* fixture fallback */
    }

    if (body.regenerate === true) {
      regenPostCalls += 1;
      markRegenRequestSeen();
      await regenRelease;

      if (outcome === "failed") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "재생성 테스트 실패" }),
        });
        return;
      }

      activeAssistantContent = REGEN_SUCCESS_CONTENT;
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
        },
        body: buildMockRegenSuccessSseBody(body.chatId ?? 0),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
      },
      body: buildMockChatSseBody(body.chatId ?? 0),
    });
  });

  return {
    getTargetPollCalls: () => targetPollCalls,
    getChatPostCalls: () => chatPostCalls,
    getRegenPostCalls: () => regenPostCalls,
    waitForRegenRequest: () => regenRequestSeen,
    releaseRegenResponse,
  };
}

const INITIAL_OFF_TEST_TITLE =
  "initial OFF defers display polling but reveals already-generated suggestions when enabled";

test.describe("Suggested Replies — production browser lifecycle", () => {
  test.describe.configure({ retries: 0, timeout: 90_000 });

  test.beforeEach(async ({ page }, testInfo) => {
    const initiallyOff = testInfo.title === INITIAL_OFF_TEST_TITLE;
    await page.addInitScript(
      ({ key, defaults, showSuggestedReplies }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            ...defaults,
            streamIntervalMs: 0,
            streamCharsPerTick: 64,
            showSuggestedReplies,
          })
        );
      },
      {
        key: CHAT_DISPLAY_PREFS_KEY,
        defaults: DEFAULT_CHAT_DISPLAY_PREFS,
        showSuggestedReplies: !initiallyOff,
      }
    );
    await demoLogin(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test.afterEach(async ({ page }) => {
    await resetDemoCharacterChats(page);
  });

  test(INITIAL_OFF_TEST_TITLE, async ({ page }) => {
    const mock = await installSuggestedRepliesTurnMock(page);
    await openFreshChat(page);

    const toggle = page.getByRole("switch", { name: "추천 메시지" });
    const textarea = page.locator("textarea[placeholder*='메시지 입력']");

    await expect(toggle).toHaveText("추천 꺼짐");
    await setReactTextareaValue(page, "처음부터 OFF 생성 테스트");

    const responseWait = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/chat" &&
        response.request().method() === "POST",
      { timeout: 45_000 }
    );
    await page.getByRole("button", { name: "전송", exact: true }).click();
    expect((await responseWait).ok()).toBeTruthy();

    await page.waitForTimeout(750);
    expect(mock.getChatPostCalls()).toBe(1);
    expect(mock.getTargetPollCalls()).toBe(0);
    await expect(page.getByText("추천 메시지 준비 중…", { exact: true })).toHaveCount(0);
    for (const reply of REPLIES) {
      await expect(page.getByText(reply.text, { exact: true })).toHaveCount(0);
    }

    await toggle.click();
    await expect(toggle).toHaveText("추천 켜짐");
    await expect(page.getByText("추천 메시지 준비 중…", { exact: true })).toBeVisible({
      timeout: 5_000,
    });

    for (const reply of REPLIES) {
      await expect(page.getByText(reply.text, { exact: true })).toBeVisible({
        timeout: 10_000,
      });
    }

    await expect.poll(mock.getTargetPollCalls, { timeout: 10_000 }).toBe(2);
    expect(mock.getChatPostCalls()).toBe(1);
    await expect(textarea).toHaveValue("");
  });

  test("reload restores persisted generation-scoped suggestions without polling again", async ({ page }) => {
    await openFreshChat(page);

    const chatId = Number(new URL(page.url()).searchParams.get("chat"));
    expect(Number.isInteger(chatId) && chatId > 0).toBeTruthy();

    const seeded = seedPersistedSuggestedRepliesForReload(chatId);
    let seededMessagePollCalls = 0;

    await page.route("**/api/chat/suggested-replies**", async (route: Route) => {
      const url = new URL(route.request().url());
      const messageId = Number(url.searchParams.get("messageId"));
      if (messageId !== seeded.assistantMessageId) {
        await route.continue();
        return;
      }

      seededMessagePollCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          messageId,
          requested: true,
          pending: false,
          failed: false,
          replies: REPLIES,
        }),
      });
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForChatInputReady(page);

    await expect(page.getByText(seeded.content, { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    for (const reply of REPLIES) {
      await expect(page.getByText(reply.text, { exact: true })).toBeVisible({
        timeout: 10_000,
      });
    }

    await page.waitForTimeout(1_000);
    expect(seededMessagePollCalls).toBe(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForChatInputReady(page);

    await expect(page.getByText(seeded.content, { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    for (const reply of REPLIES) {
      await expect(page.getByText(reply.text, { exact: true })).toBeVisible({
        timeout: 10_000,
      });
    }

    await page.waitForTimeout(1_000);
    expect(seededMessagePollCalls).toBe(0);
  });

  test("reload resumes a persisted pending generation and settles when the read-only poll becomes ready", async ({ page }) => {
    await openFreshChat(page);

    const chatId = Number(new URL(page.url()).searchParams.get("chat"));
    expect(Number.isInteger(chatId) && chatId > 0).toBeTruthy();

    const seeded = seedPersistedSuggestedRepliesForReload(chatId, "pending");
    let seededMessagePollCalls = 0;
    let releaseReadyPoll!: () => void;
    const readyPollRelease = new Promise<void>((resolve) => {
      releaseReadyPoll = resolve;
    });

    await page.route("**/api/chat/suggested-replies**", async (route: Route) => {
      const url = new URL(route.request().url());
      const messageId = Number(url.searchParams.get("messageId"));
      if (messageId !== seeded.assistantMessageId) {
        await route.continue();
        return;
      }

      seededMessagePollCalls += 1;
      await readyPollRelease;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          messageId,
          requested: true,
          pending: false,
          failed: false,
          replies: REPLIES,
        }),
      });
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForChatInputReady(page);

    await expect(page.getByText(seeded.content, { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("추천 메시지 준비 중…", { exact: true })).toBeVisible({
      timeout: 5_000,
    });
    await expect.poll(() => seededMessagePollCalls, { timeout: 5_000 }).toBe(1);

    releaseReadyPoll();

    for (const reply of REPLIES) {
      await expect(page.getByText(reply.text, { exact: true })).toBeVisible({
        timeout: 10_000,
      });
    }
    await expect(page.getByText("추천 메시지 준비 중…", { exact: true })).toHaveCount(0);

    await page.waitForTimeout(1_000);
    expect(seededMessagePollCalls).toBe(1);
  });

  test("successful regeneration replaces previous-generation suggestions with the new trio", async ({ page }) => {
    const mock = await installSuggestedRepliesRegenerationMock(page, "success");
    await openFreshChat(page);

    const textarea = page.locator("textarea[placeholder*='메시지 입력']");
    await setReactTextareaValue(page, "재생성 성공 전환 테스트");

    const responseWait = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/chat" &&
        response.request().method() === "POST",
      { timeout: 45_000 }
    );
    await page.getByRole("button", { name: "전송", exact: true }).click();
    expect((await responseWait).ok()).toBeTruthy();

    await expect(page.getByText(MOCK_ASSISTANT_CONTENT, { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    for (const reply of REPLIES) {
      await expect(page.getByText(reply.text, { exact: true })).toBeVisible({
        timeout: 10_000,
      });
    }
    await expect.poll(mock.getTargetPollCalls, { timeout: 10_000 }).toBe(2);

    await page.getByRole("button", { name: "재생성", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "재생성", exact: true }).click();
    await mock.waitForRegenRequest();
    await expect.poll(mock.getRegenPostCalls, { timeout: 5_000 }).toBe(1);

    await expect(page.getByText(MOCK_ASSISTANT_CONTENT, { exact: true })).toHaveCount(0);
    for (const reply of REPLIES) {
      await expect(page.getByText(reply.text, { exact: true })).toHaveCount(0);
    }

    mock.releaseRegenResponse();

    await expect(page.getByText(REGEN_SUCCESS_CONTENT, { exact: true })).toBeVisible({
      timeout: 5_000,
    });
    await expect.poll(mock.getTargetPollCalls, { timeout: 10_000 }).toBe(4);
    for (const reply of REGEN_REPLIES) {
      await expect(page.getByText(reply.text, { exact: true })).toBeVisible({
        timeout: 10_000,
      });
    }
    for (const reply of REPLIES) {
      await expect(page.getByText(reply.text, { exact: true })).toHaveCount(0);
    }

    await page.waitForTimeout(750);
    expect(mock.getTargetPollCalls()).toBe(4);
    expect(mock.getChatPostCalls()).toBe(2);
    expect(mock.getRegenPostCalls()).toBe(1);
    await expect(textarea).toHaveValue("");
  });

  test("failed regeneration hides then restores the previous generation suggestions", async ({ page }) => {
    const mock = await installSuggestedRepliesRegenerationMock(page, "failed");
    await openFreshChat(page);

    const textarea = page.locator("textarea[placeholder*='메시지 입력']");
    await setReactTextareaValue(page, "재생성 실패 복구 테스트");

    const responseWait = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/chat" &&
        response.request().method() === "POST",
      { timeout: 45_000 }
    );
    await page.getByRole("button", { name: "전송", exact: true }).click();
    expect((await responseWait).ok()).toBeTruthy();

    await expect(page.getByText(MOCK_ASSISTANT_CONTENT, { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    for (const reply of REPLIES) {
      await expect(page.getByText(reply.text, { exact: true })).toBeVisible({
        timeout: 10_000,
      });
    }
    await expect.poll(mock.getTargetPollCalls, { timeout: 10_000 }).toBe(2);

    await page.getByRole("button", { name: "재생성", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "재생성", exact: true }).click();
    await mock.waitForRegenRequest();
    await expect.poll(mock.getRegenPostCalls, { timeout: 5_000 }).toBe(1);

    await expect(page.getByText(MOCK_ASSISTANT_CONTENT, { exact: true })).toHaveCount(0);
    for (const reply of REPLIES) {
      await expect(page.getByText(reply.text, { exact: true })).toHaveCount(0);
    }

    mock.releaseRegenResponse();

    await expect(page.getByText(MOCK_ASSISTANT_CONTENT, { exact: true })).toBeVisible({
      timeout: 5_000,
    });
    for (const reply of REPLIES) {
      await expect(page.getByText(reply.text, { exact: true })).toBeVisible({
        timeout: 5_000,
      });
    }

    await page.waitForTimeout(750);
    expect(mock.getTargetPollCalls()).toBe(2);
    expect(mock.getChatPostCalls()).toBe(2);
    expect(mock.getRegenPostCalls()).toBe(1);
    await expect(textarea).toHaveValue("");
  });

  test("variant switch immediately clears previous-generation suggestions", async ({ page }) => {
    const mock = await installSuggestedRepliesVariantSwitchMock(page);
    await openFreshChat(page);

    const textarea = page.locator("textarea[placeholder*='메시지 입력']");
    await setReactTextareaValue(page, "버전 전환 테스트");

    const responseWait = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/chat" &&
        response.request().method() === "POST",
      { timeout: 45_000 }
    );
    await page.getByRole("button", { name: "전송", exact: true }).click();
    expect((await responseWait).ok()).toBeTruthy();

    for (const reply of REPLIES) {
      await expect(page.getByText(reply.text, { exact: true })).toBeVisible({
        timeout: 10_000,
      });
    }
    await expect.poll(mock.getTargetPollCalls, { timeout: 10_000 }).toBe(2);

    const variantNav = page.getByRole("navigation", { name: "재생성 버전" });
    await expect(variantNav).toContainText("1 / 2");
    await expect(page.getByText(VARIANT_ONE_CONTENT, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "다음 버전" }).click();
    await expect.poll(mock.getVariantPatchCalls, { timeout: 5_000 }).toBe(1);

    await expect(variantNav).toContainText("2 / 2");
    await expect(page.getByText(VARIANT_TWO_CONTENT, { exact: true })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(VARIANT_ONE_CONTENT, { exact: true })).toHaveCount(0);

    await expect(page.getByText("추천 메시지 준비 중…", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^정석 ·/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^한 수 ·/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^드립 ·/ })).toHaveCount(0);

    await page.waitForTimeout(1_000);
    expect(mock.getTargetPollCalls()).toBe(2);
    expect(mock.getChatPostCalls()).toBe(1);
    expect(mock.getVariantPatchCalls()).toBe(1);
    await expect(textarea).toHaveValue("");
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

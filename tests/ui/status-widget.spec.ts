import { expect, test, type Page, type Route } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_STATUS_WIDGET } from "../../src/lib/statusWidget/defaultTemplate";

const CHARACTER_ID = 2;
const MOCK_USER_MESSAGE_ID = 290_001;
const MOCK_ASSISTANT_MESSAGE_ID = 290_002;

const STATUS_VALUES = {
  character: {
    시간: "14:30",
    장소: "카페",
    속마음: "긴장되지만 침착하게 대화를 이어가고 싶다.",
    현재상황: "마주 앉아 서로의 다음 말을 기다리는 중이다.",
    의식의흐름: "표정을 살핀다 → 분위기를 읽는다 → 천천히 말을 고른다",
  },
  user: null,
  extracted_facts: [],
};

function requirePlaywrightDbPath(): string {
  const dataDir = process.env.PLAYWRIGHT_DATA_DIR;
  if (!dataDir) {
    throw new Error("PLAYWRIGHT_DATA_DIR must be resolved by playwright.config.ts");
  }
  const dbPath = path.resolve(dataDir, "app.db");
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Expected Playwright app database: ${dbPath}`);
  }
  return dbPath;
}

function replaceCharacterStatusWidget(
  characterId: number,
  widgetJson: string
): { previousWidgetJson: string | null; previousAllowUserOverride: number | null } {
  const db = new Database(requirePlaywrightDbPath());
  try {
    const row = db
      .prepare(
        "SELECT status_widget_json, status_widget_allow_user_override FROM characters WHERE id=?"
      )
      .get(characterId) as
      | { status_widget_json: string | null; status_widget_allow_user_override: number | null }
      | undefined;
    if (!row) throw new Error(`Character ${characterId} not found in Playwright DB`);

    db.prepare(
      "UPDATE characters SET status_widget_json=?, status_widget_allow_user_override=0 WHERE id=?"
    ).run(widgetJson, characterId);

    return {
      previousWidgetJson: row.status_widget_json,
      previousAllowUserOverride: row.status_widget_allow_user_override,
    };
  } finally {
    db.close();
  }
}

function restoreCharacterStatusWidget(
  characterId: number,
  previous: { previousWidgetJson: string | null; previousAllowUserOverride: number | null }
): void {
  const db = new Database(requirePlaywrightDbPath());
  try {
    db.prepare(
      "UPDATE characters SET status_widget_json=?, status_widget_allow_user_override=? WHERE id=?"
    ).run(
      previous.previousWidgetJson,
      previous.previousAllowUserOverride,
      characterId
    );
  } finally {
    db.close();
  }
}

function seedPersistedStatusWidgetTurn(chatId: number): {
  assistantMessageId: number;
  content: string;
} {
  const db = new Database(requirePlaywrightDbPath());
  const requestId = `status-widget-reload-${chatId}`;
  const content =
    "새로고침 복원용 답변이다. 유나는 저장된 상태값이 화면에 그대로 이어지는지 조용히 확인했다.";

  try {
    let assistantMessageId = 0;
    db.transaction(() => {
      db.prepare(
        "INSERT INTO messages (chat_id, role, content, model, generation_status, request_id) VALUES (?, 'user', ?, 'playwright-fixture', 'completed', ?)"
      ).run(chatId, "상태창 새로고침 복원 테스트", `${requestId}:user`);

      const result = db.prepare(
        "INSERT INTO messages (chat_id, role, content, model, generation_status, request_id, status_widget_values_json, status_widget_turn_active) VALUES (?, 'assistant', ?, 'playwright-fixture', 'completed', ?, ?, 1)"
      ).run(chatId, content, requestId, JSON.stringify(STATUS_VALUES));
      assistantMessageId = Number(result.lastInsertRowid);
    })();

    if (!Number.isInteger(assistantMessageId) || assistantMessageId <= 0) {
      throw new Error("failed to seed persisted Status Widget assistant row");
    }
    return { assistantMessageId, content };
  } finally {
    db.close();
  }
}

function currentChatId(page: Page): number {
  const raw = new URL(page.url()).searchParams.get("chat");
  const chatId = Number(raw);
  if (!Number.isInteger(chatId) || chatId <= 0) {
    throw new Error(`Expected positive chat id in URL, got: ${raw ?? "null"}`);
  }
  return chatId;
}

async function demoLogin(page: Page) {
  const response = await page.request.post("/api/auth/demo-login");
  expect(response.ok()).toBeTruthy();
}

async function resetDemoCharacterChats(page: Page, characterId = CHARACTER_ID) {
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
    if (await page.getByRole("button", { name: "전송", exact: true }).isEnabled()) {
      await setReactTextareaValue(page, "");
      await expect(textarea).toHaveValue("");
      return;
    }
    await page.waitForTimeout(200);
  }
  throw new Error("Chat input did not hydrate for Status Widget Playwright test");
}

async function openFreshChat(page: Page) {
  await page.goto(`/chat/${CHARACTER_ID}?fresh=1`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForURL(/\/chat\/\d+\?chat=\d+/, { timeout: 45_000 });
  await page.waitForSelector("textarea[placeholder*='메시지 입력']", {
    timeout: 45_000,
  });
  await page.waitForSelector("article", { timeout: 45_000 });
  await waitForChatInputReady(page);
}

function buildMockChatSseBody(chatId: number, values: typeof STATUS_VALUES | null): string {
  const requestId = values ? "status-widget-ready-e2e" : "status-widget-empty-e2e";
  const finalContent = values
    ? "유나는 컵 가장자리를 손끝으로 짚고 천천히 시선을 들었다."
    : "유나는 잠시 생각에 잠겼다가 짧게 고개를 끄덕였다.";

  return [
    `data: ${JSON.stringify({
      type: "turn_persisted",
      chatId,
      messageId: MOCK_ASSISTANT_MESSAGE_ID,
      userMessageId: MOCK_USER_MESSAGE_ID,
      requestId,
    })}\n\n`,
    `data: ${JSON.stringify({ type: "append", text: finalContent })}\n\n`,
    `data: ${JSON.stringify({
      type: "done",
      chatId,
      messageId: MOCK_ASSISTANT_MESSAGE_ID,
      userMessageId: MOCK_USER_MESSAGE_ID,
      requestId,
      finalContent,
      generationStatus: "completed",
      statusWidgetActive: true,
      statusWidgetTurnActive: true,
      statusWidgetValues: values,
      suggestedRepliesPending: false,
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

async function installStatusWidgetTurnMock(
  page: Page,
  values: typeof STATUS_VALUES | null
) {
  let chatPostCalls = 0;

  await page.route("**/api/chat/message**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        messageId: MOCK_ASSISTANT_MESSAGE_ID,
        content: values
          ? "유나는 컵 가장자리를 손끝으로 짚고 천천히 시선을 들었다."
          : "유나는 잠시 생각에 잠겼다가 짧게 고개를 끄덕였다.",
        generationStatus: "completed",
        statusWidgetTurnActive: true,
        statusWidgetValues: values,
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
      body: buildMockChatSseBody(chatId, values),
    });
  });

  return { getChatPostCalls: () => chatPostCalls };
}

test.describe("Status Widget — production browser lifecycle", () => {
  test.describe.configure({ retries: 0, timeout: 90_000 });

  let previousWidget: ReturnType<typeof replaceCharacterStatusWidget> | null = null;

  test.beforeEach(async ({ page }) => {
    await demoLogin(page);
    await resetDemoCharacterChats(page);
    previousWidget = replaceCharacterStatusWidget(
      CHARACTER_ID,
      JSON.stringify(DEFAULT_STATUS_WIDGET)
    );
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test.afterEach(async ({ page }) => {
    await resetDemoCharacterChats(page);
    if (previousWidget) {
      restoreCharacterStatusWidget(CHARACTER_ID, previousWidget);
      previousWidget = null;
    }
  });

  test("active turn with usable values renders the configured status card", async ({ page }) => {
    const mock = await installStatusWidgetTurnMock(page, STATUS_VALUES);
    await openFreshChat(page);

    const textarea = page.locator("textarea[placeholder*='메시지 입력']");
    await setReactTextareaValue(page, "상태창 정상 렌더 테스트");

    const responseWait = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/chat" &&
        response.request().method() === "POST",
      { timeout: 45_000 }
    );
    await page.getByRole("button", { name: "전송", exact: true }).click();
    expect((await responseWait).ok()).toBeTruthy();

    const card = page.locator(".status-widget-card").last();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText("STATUS REPORT");
    await expect(card).toContainText("14:30");
    await expect(card).toContainText("카페");
    await expect(card).toContainText("긴장되지만 침착하게 대화를 이어가고 싶다.");
    await expect(card).toContainText("마주 앉아 서로의 다음 말을 기다리는 중이다.");
    await expect(card).toContainText("표정을 살핀다 → 분위기를 읽는다 → 천천히 말을 고른다");

    expect(mock.getChatPostCalls()).toBe(1);
  });

  test("reload hydrates persisted status values through the server page path", async ({ page }) => {
    await openFreshChat(page);
    const chatId = currentChatId(page);
    const seeded = seedPersistedStatusWidgetTurn(chatId);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("article", { timeout: 45_000 });

    await expect(page.getByText(seeded.content, { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    const card = page.locator(".status-widget-card").last();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText("STATUS REPORT");
    await expect(card).toContainText("14:30");
    await expect(card).toContainText("카페");
    await expect(card).toContainText("긴장되지만 침착하게 대화를 이어가고 싶다.");
    await expect(card).toContainText("마주 앉아 서로의 다음 말을 기다리는 중이다.");
    await expect(card).toContainText("표정을 살핀다 → 분위기를 읽는다 → 천천히 말을 고른다");
  });

  test("active turn with no usable values does not render a placeholder card", async ({ page }) => {
    const mock = await installStatusWidgetTurnMock(page, null);
    await openFreshChat(page);

    await setReactTextareaValue(page, "상태창 추출 실패 테스트");
    const responseWait = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/chat" &&
        response.request().method() === "POST",
      { timeout: 45_000 }
    );
    await page.getByRole("button", { name: "전송", exact: true }).click();
    expect((await responseWait).ok()).toBeTruthy();

    await page.waitForTimeout(500);
    await expect(page.locator(".status-widget-card")).toHaveCount(0);
    await expect(page.getByText("STATUS REPORT", { exact: true })).toHaveCount(0);
    expect(mock.getChatPostCalls()).toBe(1);
  });
});

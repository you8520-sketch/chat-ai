import Database from "better-sqlite3";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const CHARACTER_ID = 2;
const ASSISTANT_CONTENT =
  "상태창 브라우저 검증용 답변이다. 유나는 옥상 난간 옆에서 다음 말을 조용히 기다렸다.";

const WIDGET = {
  version: 1,
  name: "Status Widget Browser E2E",
  htmlTemplate:
    '<div><strong>상태 E2E</strong><span>기분 {{mood}}</span><span>장소 {{place}}</span></div>',
  fields: [
    {
      id: "mood",
      label: "기분",
      instruction: "현재 장면의 사용자 기분을 한 단어로 기록한다.",
    },
    {
      id: "place",
      label: "장소",
      instruction: "현재 장면의 위치를 짧게 기록한다.",
    },
  ],
  placement: "bottom",
} as const;

async function demoLogin(page: Page) {
  const response = await page.request.post("/api/auth/demo-login");
  expect(response.ok()).toBeTruthy();
}

async function resetDemoCharacterChats(page: Page) {
  const response = await page.request.delete("/api/chat/session", {
    data: { characterIds: [CHARACTER_ID] },
  });
  if (!response.ok() && response.status() !== 404 && response.status() !== 401) {
    throw new Error(
      `Failed to reset demo chats: ${response.status()} ${await response.text()}`
    );
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
  throw new Error("Chat input did not hydrate for Status Widget Playwright test");
}

async function openFreshChat(page: Page): Promise<number> {
  await page.goto(`/chat/${CHARACTER_ID}?fresh=1`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForURL(/\/chat\/\d+\?chat=\d+/, { timeout: 45_000 });
  await page.waitForSelector("textarea[placeholder*='메시지 입력']", {
    timeout: 45_000,
  });
  await page.waitForSelector("article", { timeout: 45_000 });
  await waitForChatInputReady(page);

  const chatId = Number(new URL(page.url()).searchParams.get("chat"));
  if (!Number.isInteger(chatId) || chatId <= 0) {
    throw new Error(`Failed to resolve chat id from ${page.url()}`);
  }
  return chatId;
}

async function createPersonaAndWidget(
  page: Page,
  chatId: number
): Promise<{ personaId: number; presetId: number }> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const personaResponse = await page.request.post("/api/personas", {
    data: {
      name: `StatusWidgetE2E-${suffix}`,
      gender: "other",
      description: "상태창 브라우저 테스트 전용 페르소나.",
      memo: "",
    },
  });
  expect(personaResponse.ok()).toBeTruthy();
  const personaBody = (await personaResponse.json()) as {
    persona?: { id?: number };
  };
  const personaId = Number(personaBody.persona?.id);
  expect(Number.isInteger(personaId) && personaId > 0).toBeTruthy();

  const presetResponse = await page.request.post("/api/status-widget-presets", {
    data: {
      title: `StatusWidgetE2E-${suffix}`,
      widget_json: JSON.stringify(WIDGET),
    },
  });
  expect(presetResponse.ok()).toBeTruthy();
  const presetBody = (await presetResponse.json()) as {
    preset?: { id?: number };
  };
  const presetId = Number(presetBody.preset?.id);
  expect(Number.isInteger(presetId) && presetId > 0).toBeTruthy();

  const widgetSelect = await page.request.patch(
    `/api/personas/${personaId}/status-widget`,
    { data: { presetId } }
  );
  expect(widgetSelect.ok()).toBeTruthy();

  const personaSelect = await page.request.patch("/api/chat/persona", {
    data: { chatId, selectedPersonaId: personaId },
  });
  expect(personaSelect.ok()).toBeTruthy();

  const displaySelect = await page.request.patch("/api/chat/settings", {
    data: { chatId, statusWidgetDisplayMode: "user" },
  });
  expect(displaySelect.ok()).toBeTruthy();

  return { personaId, presetId };
}

function seedPersistedStatusWidgetTurn(chatId: number): number {
  const dataDir = process.env.PLAYWRIGHT_DATA_DIR;
  if (!dataDir) {
    throw new Error("PLAYWRIGHT_DATA_DIR must be resolved by playwright.config.ts");
  }

  const db = new Database(path.resolve(dataDir, "app.db"));
  const requestId = `status-widget-browser-e2e-${chatId}`;
  try {
    let assistantMessageId = 0;
    db.transaction(() => {
      db.prepare(
        "INSERT INTO messages (chat_id, role, content, model, generation_status, request_id) VALUES (?, 'user', ?, 'playwright-fixture', 'completed', ?)"
      ).run(chatId, "현재 기분과 장소를 확인해 줘.", `${requestId}:user`);

      const result = db
        .prepare(
          `INSERT INTO messages (
             chat_id,
             role,
             content,
             model,
             generation_status,
             request_id,
             status_widget_values_json,
             status_widget_turn_active
           ) VALUES (?, 'assistant', ?, 'playwright-fixture', 'completed', ?, ?, 1)`
        )
        .run(
          chatId,
          ASSISTANT_CONTENT,
          requestId,
          JSON.stringify({
            user: {
              mood: "집중",
              place: "옥상",
            },
          })
        );
      assistantMessageId = Number(result.lastInsertRowid);
    })();

    if (!Number.isInteger(assistantMessageId) || assistantMessageId <= 0) {
      throw new Error("failed to seed persisted Status Widget assistant row");
    }
    return assistantMessageId;
  } finally {
    db.close();
  }
}

async function cleanupFixture(
  page: Page,
  ids: { personaId: number | null; presetId: number | null }
) {
  await resetDemoCharacterChats(page);

  if (ids.presetId != null) {
    const response = await page.request.delete(
      `/api/status-widget-presets/${ids.presetId}`
    );
    if (!response.ok() && response.status() !== 404) {
      throw new Error(
        `Failed to delete status widget preset: ${response.status()} ${await response.text()}`
      );
    }
  }

  if (ids.personaId != null) {
    const response = await page.request.delete(`/api/personas/${ids.personaId}`);
    if (!response.ok() && response.status() !== 404) {
      throw new Error(
        `Failed to delete test persona: ${response.status()} ${await response.text()}`
      );
    }
  }
}

test.describe("Status Widget — persisted production browser lifecycle", () => {
  test.describe.configure({ retries: 0, timeout: 90_000 });

  test("persisted user-widget values render through the real chat renderer after reload", async ({
    page,
  }) => {
    const ids = { personaId: null as number | null, presetId: null as number | null };
    await demoLogin(page);
    await page.setViewportSize({ width: 1280, height: 720 });

    try {
      await resetDemoCharacterChats(page);
      const chatId = await openFreshChat(page);
      const created = await createPersonaAndWidget(page, chatId);
      ids.personaId = created.personaId;
      ids.presetId = created.presetId;

      seedPersistedStatusWidgetTurn(chatId);

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("article", { timeout: 45_000 });

      await expect(page.getByText(ASSISTANT_CONTENT, { exact: true })).toBeVisible({
        timeout: 10_000,
      });

      const card = page.locator(".status-widget-card").filter({ hasText: "상태 E2E" });
      await expect(card).toHaveCount(1);
      await expect(card).toContainText("기분 집중");
      await expect(card).toContainText("장소 옥상");

      await expect(page.getByText('{"user":{"mood":"집중","place":"옥상"}}')).toHaveCount(0);
    } finally {
      await cleanupFixture(page, ids);
    }
  });
});

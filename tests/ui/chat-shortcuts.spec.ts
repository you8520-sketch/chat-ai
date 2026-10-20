import { expect, test, type Page } from "@playwright/test";
import { ensureLivePickerModel } from "./helpers/ensureLivePickerModel";
import { openExplicitFreshChat } from "./helpers/openExplicitChat";

const composer = (page: Page) => page.locator("textarea[placeholder*='메시지 입력']");

async function openChat(page: Page, characterId = 2) {
  await page.request.post("/api/auth/demo-login");
  await page.goto("/health", { waitUntil: "domcontentloaded" });
  await openExplicitFreshChat(page, characterId);
  await expect(composer(page)).toBeVisible({ timeout: 45_000 });
  await ensureLivePickerModel(page);
}

test.describe.configure({ timeout: 90_000 });

async function setComposer(page: Page, value: string, caret: number) {
  const box = composer(page);
  await box.evaluate(
    (el, payload: { value: string; caret: number }) => {
      const textarea = el as HTMLTextAreaElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, payload.value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.focus();
      textarea.setSelectionRange(payload.caret, payload.caret);
      textarea.dispatchEvent(new Event("select", { bubbles: true }));
      textarea.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    },
    { value, caret }
  );
  await expect(box).toHaveValue(value);
}

test.describe("personal chat shortcuts", () => {
  test("saves, edits, favorites, inserts, and survives refresh without a chat call", async ({ page }) => {
    const chatPosts: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() !== "POST") return;
      if (url.pathname === "/api/chat" || url.pathname === "/api/chat/message") chatPosts.push(url.pathname);
    });
    await openChat(page, 2);
    const pointsBefore = await page.getByText("2,000P").first().textContent();

    await page.getByTestId("chat-shortcuts-open").click();
    await page.getByRole("button", { name: "새로 만들기" }).click();
    await page.getByTestId("chat-shortcuts-name").fill("인사");
    await page.getByTestId("chat-shortcuts-description").fill("첫 마디");
    await page.getByTestId("chat-shortcuts-content").fill("잘 지냈어?");
    await page.getByTestId("chat-shortcuts-save").click();
    await expect(page.getByTestId("chat-shortcuts-preview")).toContainText("잘 지냈어?");

    await page.getByTestId("chat-shortcuts-panel").getByRole("button", { name: "수정" }).click();
    await page.getByTestId("chat-shortcuts-content").fill("오늘 잘 지냈어?");
    await page.getByTestId("chat-shortcuts-save").click();
    await expect(page.getByTestId("chat-shortcuts-preview")).toContainText("오늘 잘 지냈어?");

    await page.getByRole("button", { name: "인사 즐겨찾기" }).click();
    await expect(page.getByRole("button", { name: "인사 즐겨찾기 해제" })).toBeVisible();

    await setComposer(page, "안녕", 1);
    await page.getByTestId("chat-shortcuts-insert").click();
    await expect(composer(page)).toHaveValue("안오늘 잘 지냈어?녕");
    await expect(page.getByTestId("chat-shortcuts-panel")).toHaveCount(0);

    await page.reload();
    await expect(composer(page)).toBeVisible({ timeout: 45_000 });
    await page.getByTestId("chat-shortcuts-open").click();
    await page.getByRole("button", { name: "★ 인사" }).click();
    await expect(page.getByTestId("chat-shortcuts-preview")).toContainText("오늘 잘 지냈어?");

    await openExplicitFreshChat(page, 3);
    await expect(composer(page)).toBeVisible({ timeout: 45_000 });
    await page.getByTestId("chat-shortcuts-open").click();
    await page.getByRole("button", { name: "★ 인사" }).click();
    await expect(page.getByTestId("chat-shortcuts-preview")).toContainText("오늘 잘 지냈어?");
    await page.getByRole("button", { name: "삭제" }).click();
    await page.getByTestId("chat-shortcuts-delete-confirm").click();
    await expect(page.getByRole("button", { name: "★ 인사" })).toHaveCount(0);

    expect(chatPosts).toEqual([]);
    await expect(page.getByText(pointsBefore ?? "2,000P").first()).toHaveText(pointsBefore ?? "2,000P");
  });

  test("does not slice when the shortcut would overflow", async ({ page }) => {
    await openChat(page);
    await page.getByTestId("chat-shortcuts-open").click();
    await page.getByRole("button", { name: "새로 만들기" }).click();
    await page.getByTestId("chat-shortcuts-name").fill("길게");
    await page.getByTestId("chat-shortcuts-content").fill("단축");
    await page.getByTestId("chat-shortcuts-save").click();
    const draft = "가".repeat(1499);
    await setComposer(page, draft, draft.length);
    await page.getByTestId("chat-shortcuts-insert").click();
    await expect(composer(page)).toHaveValue(draft);
    await expect(page.getByTestId("chat-shortcuts-notice")).toContainText("입력 길이 제한");
  });

  test("locks insert during send and restores the draft after failure", async ({ page }) => {
    await openChat(page);
    await page.getByTestId("chat-shortcuts-open").click();
    await page.getByRole("button", { name: "새로 만들기" }).click();
    await page.getByTestId("chat-shortcuts-name").fill("잠금");
    await page.getByTestId("chat-shortcuts-content").fill("넣지마");
    await page.getByTestId("chat-shortcuts-save").click();
    await page.getByTestId("chat-shortcuts-close").click();
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/chat", async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== "POST" || url.pathname !== "/api/chat") {
        await route.continue();
        return;
      }
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "테스트 실패" }),
      });
    });
    await setComposer(page, "복구될 초안", 6);
    await page.getByRole("button", { name: "전송", exact: true }).click();
    await expect(composer(page)).toBeDisabled();
    await page.getByTestId("chat-shortcuts-open").click();
    await page.getByTestId("chat-shortcuts-panel").getByRole("button", { name: "잠금", exact: true }).click();
    await expect(page.getByTestId("chat-shortcuts-insert")).toBeDisabled();
    release?.();
    await expect(composer(page)).toHaveValue("복구될 초안");
    await expect(composer(page)).toBeEnabled();
  });

  test("evidence screenshots at 390 and 1280", async ({ page }, testInfo) => {
    await openChat(page);
    await setComposer(page, "기존 초안", 2);
    await page.getByTestId("chat-shortcuts-open").click();
    await page.getByRole("button", { name: "새로 만들기" }).click();
    await page.getByTestId("chat-shortcuts-name").fill("증거");
    await page.getByTestId("chat-shortcuts-content").fill("확인 후 삽입");
    await page.getByTestId("chat-shortcuts-save").click();
    await expect(page.getByTestId("chat-shortcuts-preview")).toContainText("확인 후 삽입");
    for (const viewport of [
      { width: 390, height: 844, tag: "390" },
      { width: 1280, height: 800, tag: "1280" },
    ] as const) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      if ((await page.getByTestId("chat-shortcuts-panel").count()) === 0) {
        await page.getByTestId("chat-shortcuts-open").click();
      }
      await expect(page.getByTestId("chat-shortcuts-preview")).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`shortcuts-panel-${viewport.tag}.png`),
        fullPage: true,
      });
    }
    await page.getByTestId("chat-shortcuts-insert").click();
    await expect(composer(page)).toBeFocused();
    await expect(composer(page)).toHaveValue("기존확인 후 삽입 초안");
    for (const viewport of [
      { width: 390, height: 844, tag: "390" },
      { width: 1280, height: 800, tag: "1280" },
    ] as const) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.screenshot({
        path: testInfo.outputPath(`shortcuts-composer-${viewport.tag}.png`),
        fullPage: true,
      });
    }
  });
});

import { expect, type Page } from "@playwright/test";
import { ensureLivePickerModel } from "./ensureLivePickerModel";
import { openExplicitFreshChat } from "./openExplicitChat";

export const composer = (page: Page) => page.locator("textarea[placeholder*='메시지 입력']");
export const panel = (page: Page) => page.getByTestId("chat-shortcuts-panel");

export const LONG_SHORTCUT_BUTTON = "긴 장면 이어가기 여러 줄 내용 미리보기 확인용 단축어입니다";

const LONG_CONTENT = Array.from(
  { length: 9 },
  (_, i) =>
    `${i + 1}. 오늘은 조금 늦었지만 천천히 이야기해도 괜찮을까요? 장면이 길어져도 그대로 이어서 말하고 싶어서 미리 적어 두었어요.`
).join("\n");

export async function openChat(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.request.post("/api/auth/demo-login");
  await page.goto("/health", { waitUntil: "domcontentloaded" });
  await openExplicitFreshChat(page, 2);
  await expect(composer(page)).toBeVisible({ timeout: 45_000 });
  await ensureLivePickerModel(page);
  await page.evaluate(async () => {
    const list = await fetch("/api/chat/shortcuts").then((r) => r.json());
    for (const row of list.shortcuts ?? []) {
      await fetch(`/api/chat/shortcuts/${row.id}`, { method: "DELETE" });
    }
  });
}

export async function seedShortcuts(page: Page, count: number) {
  await page.evaluate(
    async ({ count: total, longContent }) => {
      for (let i = 0; i < total; i += 1) {
        const long = i === total - 1;
        await fetch("/api/chat/shortcuts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: long ? "긴 장면 이어가기" : `자주 쓰는 문장 ${i + 1}`,
            description: long ? "여러 줄 내용 미리보기 확인용 단축어입니다" : `상황 ${i + 1}에 쓰는 한 줄 설명`,
            content: long ? longContent : `단축어 ${i + 1}번 문장입니다. 입력창에 넣은 뒤 고쳐서 보냅니다.`,
          }),
        });
      }
    },
    { count, longContent: LONG_CONTENT }
  );
}

export async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

export async function shot(page: Page, testInfo: { outputPath: (name: string) => string }, name: string) {
  await settle(page);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
}

export async function openPanelWithManyShortcuts(page: Page) {
  await seedShortcuts(page, 14);
  await page.getByTestId("chat-shortcuts-open").click();
  await expect(panel(page)).toBeVisible();
  await expect(page.getByRole("button", { name: LONG_SHORTCUT_BUTTON })).toBeVisible();
}

export async function selectLongShortcut(page: Page) {
  await page.getByRole("button", { name: LONG_SHORTCUT_BUTTON }).click();
  await expect(page.getByTestId("chat-shortcuts-preview")).toContainText("1. 오늘은");
}

export async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

import { expect, test, type Locator } from "@playwright/test";
import {
  assertNoHorizontalOverflow,
  composer,
  openChat,
  openPanelWithManyShortcuts,
  panel,
  seedShortcuts,
  selectLongShortcut,
  settle,
  shot,
} from "./helpers/chatShortcutsUi";

const VIEWPORTS = [
  { width: 390, height: 844, tag: "390" },
  { width: 1280, height: 800, tag: "1280" },
] as const;

async function minimumTextSize(locator: Locator) {
  return locator.evaluate((root) => {
    let min = Infinity;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent?.trim()) continue;
      const el = node.parentElement;
      if (!el) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      min = Math.min(min, Number.parseFloat(style.fontSize));
    }
    return min;
  });
}

async function smallestButton(locator: Locator) {
  return locator.evaluate((root) => {
    let minHeight = Infinity;
    let minWidth = Infinity;
    for (const el of root.querySelectorAll("button")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      minHeight = Math.min(minHeight, rect.height);
      minWidth = Math.min(minWidth, rect.width);
    }
    return { minHeight, minWidth };
  });
}

test.describe.configure({ timeout: 60_000 });

test.describe("personal shortcut UI design evidence", () => {
  for (const viewport of VIEWPORTS) {
    test(`renders every shortcut state at ${viewport.tag}`, async ({ page }, testInfo) => {
      await openChat(page, viewport);

      await page.getByTestId("chat-shortcuts-open").scrollIntoViewIfNeeded();
      await shot(page, testInfo, `design-01-closed-${viewport.tag}`);

      await openPanelWithManyShortcuts(page);
      await shot(page, testInfo, `design-02-list-${viewport.tag}`);

      await selectLongShortcut(page);
      await shot(page, testInfo, `design-03-preview-long-${viewport.tag}`);

      await page.getByTestId("chat-shortcuts-panel").getByRole("button", { name: "수정" }).click();
      await expect(page.getByTestId("chat-shortcuts-content")).toHaveValue(/1\. 오늘은/);
      await shot(page, testInfo, `design-04-form-${viewport.tag}`);

      await page.getByTestId("chat-shortcuts-content").fill("");
      await page.getByTestId("chat-shortcuts-name").fill("");
      await page.getByTestId("chat-shortcuts-save").click();
      await expect(page.getByTestId("chat-shortcuts-notice")).toBeVisible();
      await shot(page, testInfo, `design-05-validation-${viewport.tag}`);
    });

    test(`renders loading, list error, save failure, and delete confirm at ${viewport.tag}`, async ({
      page,
    }, testInfo) => {
      await openChat(page, viewport);
      await seedShortcuts(page, 3);

      let releaseGet: (() => void) | null = null;
      const gate = new Promise<void>((resolve) => {
        releaseGet = resolve;
      });
      let getCount = 0;
      let failPost = true;
      await page.route("**/api/chat/shortcuts**", async (route) => {
        const method = route.request().method();
        if (method === "GET") {
          getCount += 1;
          if (getCount === 1) {
            await gate;
            await route.abort("failed");
            return;
          }
        }
        if (method === "POST" && failPost) {
          failPost = false;
          await route.abort("failed");
          return;
        }
        await route.continue();
      });

      await page.getByTestId("chat-shortcuts-open").click();
      await expect(page.getByText("단축어를 불러오는 중")).toBeVisible();
      await shot(page, testInfo, `design-06-loading-${viewport.tag}`);

      releaseGet?.();
      await expect(page.getByTestId("chat-shortcuts-list-error")).toBeVisible();
      await shot(page, testInfo, `design-07-list-error-${viewport.tag}`);

      await page.getByTestId("chat-shortcuts-list-retry").click();
      await expect(page.getByRole("button", { name: "자주 쓰는 문장 1 상황 1에 쓰는 한 줄 설명", exact: true })).toBeVisible();

      await page.getByRole("button", { name: "새로 만들기" }).click();
      await page.getByTestId("chat-shortcuts-name").fill("저장 실패 예시");
      await page.getByTestId("chat-shortcuts-content").fill("네트워크가 끊겨도 쓰던 내용은 남습니다.");
      await page.getByTestId("chat-shortcuts-save").click();
      await expect(page.getByTestId("chat-shortcuts-notice")).toContainText("다시");
      await shot(page, testInfo, `design-08-save-failure-${viewport.tag}`);

      await page.getByTestId("chat-shortcuts-cancel").click();
      await expect(page.getByTestId("chat-shortcuts-name")).toHaveCount(0);
      await page.getByRole("button", { name: "자주 쓰는 문장 2 상황 2에 쓰는 한 줄 설명", exact: true }).click();
      await page.getByTestId("chat-shortcuts-panel").getByRole("button", { name: "삭제" }).click();
      await expect(page.getByTestId("chat-shortcuts-delete-confirm")).toBeVisible();
      await shot(page, testInfo, `design-09-delete-confirm-${viewport.tag}`);
    });
  }
});

test.describe("personal shortcut UI layout contract", () => {
  for (const viewport of VIEWPORTS) {
    test(`keeps the picked sentence, next actions, and composer visible at ${viewport.tag}`, async ({ page }) => {
      await openChat(page, viewport);
      await openPanelWithManyShortcuts(page);
      await selectLongShortcut(page);
      await settle(page);

      await expect(page.getByTestId("chat-shortcuts-preview")).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId("chat-shortcuts-insert")).toBeInViewport({ ratio: 1 });
      await expect(
        panel(page).getByRole("button", { name: "수정" })
      ).toBeInViewport({ ratio: 1 });
      await expect(
        panel(page).getByRole("button", { name: "삭제" })
      ).toBeInViewport({ ratio: 1 });

      const panelBox = await panel(page).boundingBox();
      const inputBox = await composer(page).boundingBox();
      expect(panelBox).not.toBeNull();
      expect(inputBox).not.toBeNull();
      expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(inputBox!.y + 1);
      expect(panelBox!.x).toBeGreaterThanOrEqual(0);
      expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport.width);
      await assertNoHorizontalOverflow(page);
    });

    test(`uses readable text and tap targets at ${viewport.tag}`, async ({ page }) => {
      await openChat(page, viewport);
      await openPanelWithManyShortcuts(page);
      await selectLongShortcut(page);
      await panel(page).getByRole("button", { name: "수정" }).click();
      await expect(page.getByTestId("chat-shortcuts-name")).toBeVisible();
      await settle(page);

      expect(await minimumTextSize(panel(page))).toBeGreaterThanOrEqual(12);
      expect(await minimumTextSize(page.getByTestId("chat-shortcuts-open"))).toBeGreaterThanOrEqual(12);

      const mobile = viewport.width < 576;
      const inPanel = await smallestButton(panel(page));
      expect(inPanel.minHeight).toBeGreaterThanOrEqual(mobile ? 36 : 32);
      expect(inPanel.minWidth).toBeGreaterThanOrEqual(mobile ? 36 : 32);
      const opener = await smallestButton(page.getByTestId("chat-shortcuts-open").locator(".."));
      expect(opener.minHeight).toBeGreaterThanOrEqual(mobile ? 36 : 28);
    });
  }

  test("does not overflow at 320px", async ({ page }, testInfo) => {
    await openChat(page, { width: 320, height: 568 });
    await openPanelWithManyShortcuts(page);
    await selectLongShortcut(page);
    await shot(page, testInfo, "design-10-preview-long-320");
    const previewBox = await panel(page).boundingBox();
    const previewOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    const insertRatio = await page.getByTestId("chat-shortcuts-insert").evaluate(async (el) => {
      return new Promise<number>((resolve) => {
        const observer = new IntersectionObserver((entries) => {
          observer.disconnect();
          resolve(entries[0]?.intersectionRatio ?? 0);
        });
        observer.observe(el);
      });
    });

    await panel(page).getByRole("button", { name: "수정" }).click();
    await expect(page.getByTestId("chat-shortcuts-save")).toBeVisible();
    await shot(page, testInfo, "design-11-form-320");
    const formBox = await panel(page).boundingBox();
    const formOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    const clipped = await panel(page).evaluate((root) =>
      Array.from(root.querySelectorAll<HTMLElement>("button, p, span, label"))
        .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === "visible")
        .map((el) => el.textContent?.slice(0, 20) ?? el.tagName)
    );

    expect(previewOverflow).toBeLessThanOrEqual(0);
    expect(formOverflow).toBeLessThanOrEqual(0);
    expect(previewBox!.x).toBeGreaterThanOrEqual(0);
    expect(previewBox!.x + previewBox!.width).toBeLessThanOrEqual(320);
    expect(formBox!.x).toBeGreaterThanOrEqual(0);
    expect(formBox!.x + formBox!.width).toBeLessThanOrEqual(320);
    expect(insertRatio).toBeGreaterThanOrEqual(0.99);
    expect(clipped).toEqual([]);
  });
});

test.describe("personal shortcut form cancel", () => {
  test("cancel closes the form and returns the selected shortcut actions", async ({ page }) => {
    await openChat(page, VIEWPORTS[0]);
    await seedShortcuts(page, 2);
    await page.getByTestId("chat-shortcuts-open").click();
    await page.getByRole("button", { name: "자주 쓰는 문장 1 상황 1에 쓰는 한 줄 설명", exact: true }).click();
    await panel(page).getByRole("button", { name: "수정" }).click();
    await page.getByTestId("chat-shortcuts-name").fill("고치다 만 이름");
    await expect(page.getByTestId("chat-shortcuts-insert")).toHaveCount(0);
    await page.getByTestId("chat-shortcuts-cancel").click();
    await expect(page.getByTestId("chat-shortcuts-name")).toHaveCount(0);
    await expect(page.getByTestId("chat-shortcuts-insert")).toBeVisible();
    await expect(page.getByRole("button", { name: "자주 쓰는 문장 1 상황 1에 쓰는 한 줄 설명", exact: true })).toBeVisible();
  });

  test("cancel during a held save keeps the form closed and still lists the saved shortcut", async ({ page }) => {
    await openChat(page, VIEWPORTS[0]);
    let releasePost: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    await page.route("**/api/chat/shortcuts**", async (route) => {
      if (route.request().method() === "POST") {
        await gate;
        await route.continue();
        return;
      }
      await route.continue();
    });
    await page.getByTestId("chat-shortcuts-open").click();
    await page.getByRole("button", { name: "새로 만들기" }).click();
    await page.getByTestId("chat-shortcuts-name").fill("취소 중 저장");
    await page.getByTestId("chat-shortcuts-content").fill("응답이 늦게 와도 폼은 닫힌 채");
    await page.getByTestId("chat-shortcuts-save").click();
    await expect(page.getByTestId("chat-shortcuts-save")).toBeDisabled();
    await page.getByTestId("chat-shortcuts-cancel").click();
    await expect(page.getByTestId("chat-shortcuts-name")).toHaveCount(0);
    releasePost?.();
    await expect(page.getByRole("button", { name: "취소 중 저장", exact: true })).toBeVisible();
    await expect(page.getByTestId("chat-shortcuts-name")).toHaveCount(0);
    await expect(page.getByTestId("chat-shortcuts-notice")).toHaveCount(0);
  });
});

import { expect, test, type Page } from "@playwright/test";
import {
  captureChatPosts,
  composer,
  composerVisibleText,
  createShortcut,
  openChat,
  panel,
  settle,
  shot,
} from "./helpers/chatShortcutsUi";

const DESKTOP = { width: 1280, height: 800 };
const chips = (page: Page) => page.getByTestId("chat-shortcut-chip");
const slashMenu = (page: Page) => page.getByTestId("chat-shortcut-slash-menu");
const slashOptions = (page: Page) => page.getByTestId("chat-shortcut-slash-option");

const AUTO_BODY =
  '다음 장면을 자연스럽게 진행하되 "따옴표"와 [자동] 같은 기호도 그대로 둔다.\n  둘째 줄은 들여쓰기를 유지한다.';
const CLEAN_BODY = "상황을 짧게 정리해 줘.";

test.describe.configure({ timeout: 120_000 });

async function insertViaDock(page: Page, label: string | RegExp) {
  await page.getByTestId("chat-shortcuts-open").click();
  await panel(page).getByRole("button", { name: label }).first().click();
  await page.getByTestId("chat-shortcuts-insert").click();
  await expect(panel(page)).toHaveCount(0);
}

async function appendToComposer(page: Page, text: string) {
  await composer(page).evaluate((el, extra) => {
    const textarea = el as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, textarea.value + extra);
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: extra, inputType: "insertText" }));
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, text);
}

async function seedSlashLibrary(page: Page) {
  await createShortcut(page, { name: "진행", description: "장면을 이어서 진행", content: "진행 본문 첫째" });
  await createShortcut(page, { name: "전투 진행", description: "전투 장면 진행", content: "전투 진행 본문" });
  await createShortcut(page, { name: "자동", description: "자동 진행 지시", content: AUTO_BODY, favorite: true });
  await createShortcut(page, { name: "인사", description: "", content: "인사 본문" });
}

test.describe("shortcut content limits", () => {
  test("499 / 500 / 501 characters and the 30 character name", async ({ page }) => {
    await openChat(page, DESKTOP);
    await page.getByTestId("chat-shortcuts-open").click();
    await page.getByRole("button", { name: "새로 만들기" }).click();
    await expect(page.getByTestId("chat-shortcuts-content")).toHaveAttribute("maxlength", "500");
    await expect(page.getByTestId("chat-shortcuts-name")).toHaveAttribute("maxlength", "30");

    await page.getByTestId("chat-shortcuts-name").fill("경계");
    await page.getByTestId("chat-shortcuts-content").fill("가".repeat(501));
    await expect(panel(page)).toContainText("500 / 500");
    await expect(page.getByTestId("chat-shortcuts-content")).toHaveValue("가".repeat(500));
    await page.getByTestId("chat-shortcuts-content").evaluate((el) => {
      const textarea = el as HTMLTextAreaElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, `${textarea.value}가`);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(panel(page)).toContainText("501 / 500");
    await page.getByTestId("chat-shortcuts-save").click();
    await expect(page.getByTestId("chat-shortcuts-notice")).toHaveText("단축어 내용은 500자까지입니다.");
    await expect(page.getByTestId("chat-shortcuts-content")).toHaveValue("가".repeat(501));

    await page.getByTestId("chat-shortcuts-content").fill("가".repeat(500));
    await page.getByTestId("chat-shortcuts-save").click();
    await expect(page.getByTestId("chat-shortcuts-preview")).toContainText("경계");

    await page.getByRole("button", { name: "새로 만들기" }).click();
    await page.getByTestId("chat-shortcuts-name").fill("경계둘");
    await page.getByTestId("chat-shortcuts-content").fill("나".repeat(499));
    await page.getByTestId("chat-shortcuts-save").click();
    await expect(page.getByTestId("chat-shortcuts-preview")).toContainText("경계둘");

    const stored = await page.evaluate(async () => {
      const list = (await fetch("/api/chat/shortcuts").then((r) => r.json())) as {
        shortcuts: Array<{ name: string; content: string }>;
      };
      return list.shortcuts.map((row) => [row.name, row.content.length]).sort();
    });
    expect(stored).toEqual([
      ["경계", 500],
      ["경계둘", 499],
    ]);
  });

  test("server rejects 501 on create and patch with one message, name over 30 too", async ({ page }) => {
    await openChat(page, DESKTOP);
    const result = await page.evaluate(async () => {
      const post = (body: unknown) =>
        fetch("/api/chat/shortcuts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).then(async (res) => ({ status: res.status, body: (await res.json()) as Record<string, any> }));
      const ok = await post({ name: "서버", content: "가".repeat(500) });
      const over = await post({ name: "서버둘", content: "가".repeat(501) });
      const longName = await post({ name: "가".repeat(31), content: "x" });
      const patch = await fetch(`/api/chat/shortcuts/${ok.body.shortcut.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "가".repeat(501) }),
      }).then(async (res) => ({ status: res.status, body: (await res.json()) as Record<string, any> }));
      return { ok: ok.status, over, longName, patch };
    });
    expect(result.ok).toBe(201);
    expect(result.over).toEqual({ status: 400, body: { error: "단축어 내용은 500자까지입니다." } });
    expect(result.patch).toEqual({ status: 400, body: { error: "단축어 내용은 500자까지입니다." } });
    expect(result.longName.status).toBe(400);
    expect(result.longName.body.error).toBe("단축어 이름은 30자까지입니다.");
  });

  test("a regular chat message still allows 1500 characters", async ({ page }) => {
    await openChat(page, DESKTOP);
    await expect(composer(page)).toHaveAttribute("maxlength", "1500");
  });
});

test.describe("shortcut selection hides the body", () => {
  test("shows name and description only; the edit form reveals the body", async ({ page }) => {
    await openChat(page, DESKTOP);
    await createShortcut(page, { name: "자동", description: "자동 진행 지시", content: AUTO_BODY });
    await createShortcut(page, { name: "무설명", content: "설명 없는 본문 텍스트" });
    await page.getByTestId("chat-shortcuts-open").click();

    await panel(page).getByRole("button", { name: "자동 자동 진행 지시", exact: true }).click();
    const preview = page.getByTestId("chat-shortcuts-preview");
    await expect(page.getByTestId("chat-shortcuts-preview-name")).toHaveText("자동");
    await expect(page.getByTestId("chat-shortcuts-preview-description")).toHaveText("자동 진행 지시");
    await expect(preview).not.toContainText("다음 장면을");
    await expect(preview).not.toContainText("둘째 줄");
    await expect(panel(page).locator("pre")).toHaveCount(0);
    await expect(preview.getByRole("button", { name: "입력창에 넣기" })).toBeVisible();
    await expect(preview.getByRole("button", { name: "수정" })).toBeVisible();
    await expect(preview.getByRole("button", { name: "삭제" })).toBeVisible();

    await panel(page).getByRole("button", { name: "무설명", exact: true }).click();
    await expect(page.getByTestId("chat-shortcuts-preview-description")).toContainText("설명이 없습니다");
    await expect(preview).not.toContainText("설명 없는 본문");

    await panel(page).getByRole("button", { name: "자동 자동 진행 지시", exact: true }).click();
    await preview.getByRole("button", { name: "수정" }).click();
    await expect(page.getByTestId("chat-shortcuts-content")).toHaveValue(AUTO_BODY);
    await expect(page.getByTestId("chat-shortcuts-name")).toHaveValue("자동");
    await expect(page.getByTestId("chat-shortcuts-description")).toHaveValue("자동 진행 지시");

    await page.getByTestId("chat-shortcuts-cancel").click();
    await expect(page.getByTestId("chat-shortcuts-content")).toHaveCount(0);
    await expect(page.getByTestId("chat-shortcuts-preview")).not.toContainText("다음 장면을");
  });
});

test.describe("name chips and the sent message", () => {
  test("two shortcuts and typed text keep order, and the API receives the saved bodies", async ({ page }) => {
    const posts = await captureChatPosts(page);
    await openChat(page, DESKTOP);
    await createShortcut(page, { name: "자동", description: "자동 진행 지시", content: AUTO_BODY, favorite: true });
    await createShortcut(page, { name: "정리", description: "상황 정리", content: CLEAN_BODY });

    await composer(page).click();
    await page.keyboard.type("먼저 ");
    await insertViaDock(page, /자동/);
    await page.keyboard.type(" 그리고 ");
    await insertViaDock(page, /정리/);
    await page.keyboard.type("끝");

    await expect(chips(page)).toHaveCount(2);
    await expect(chips(page).nth(0)).toHaveAttribute("data-chip-name", "자동");
    await expect(chips(page).nth(1)).toHaveAttribute("data-chip-name", "정리");
    const visible = await composerVisibleText(page);
    expect(visible).not.toContain("다음 장면을");
    expect(visible).not.toContain("상황을 짧게");
    expect(visible).toMatch(/^먼저 .*★.*자동.*×.* 그리고 .*정리.*×.*끝$/s);

    await page.getByRole("button", { name: "전송", exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    const message = String(posts[0]!.message);
    expect(message).toBe(`먼저 ${AUTO_BODY} 그리고 ${CLEAN_BODY}끝`);
    expect(message).not.toMatch(/[\u2060\u2061\u200B\u200C\u2062\u2063\u2064]/);
    expect(message).not.toContain("×");
    expect(JSON.stringify(posts[0])).not.toContain("★");

    await expect(chips(page)).toHaveCount(2);
    await expect(composer(page)).toBeEnabled();
    await page.getByRole("button", { name: "전송", exact: true }).click();
    await expect.poll(() => posts.length).toBe(2);
    expect(String(posts[1]!.message)).toBe(message);
  });

  test("the × button and Backspace remove only the targeted chip", async ({ page }) => {
    await openChat(page, DESKTOP);
    await createShortcut(page, { name: "자동", content: AUTO_BODY });
    await createShortcut(page, { name: "정리", content: CLEAN_BODY });
    const posts = await captureChatPosts(page);

    await composer(page).click();
    await page.keyboard.type("A");
    await insertViaDock(page, /자동/);
    await page.keyboard.type("B");
    await insertViaDock(page, /정리/);
    await page.keyboard.type("C");
    await expect(chips(page)).toHaveCount(2);

    await page.getByTestId("chat-shortcut-chip-remove").first().click();
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first()).toHaveAttribute("data-chip-name", "정리");

    // caret is after C; Backspace removes C, Backspace again removes the chip as one unit.
    await composer(page).focus();
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await expect(chips(page)).toHaveCount(0);
    expect(await composerVisibleText(page)).toBe("AB");

    await page.getByRole("button", { name: "전송", exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]!.message).toBe("AB");
  });

  test("caret moves over a chip in one step and typing around it keeps it intact", async ({ page }) => {
    await openChat(page, DESKTOP);
    await createShortcut(page, { name: "정리", content: CLEAN_BODY });
    const posts = await captureChatPosts(page);

    await composer(page).click();
    await page.keyboard.type("가나");
    await page.keyboard.press("ArrowLeft");
    await insertViaDock(page, /정리/);
    await page.keyboard.type("X");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("Y");
    await page.keyboard.press("Delete");
    await expect(chips(page)).toHaveCount(0);
    expect(await composerVisibleText(page)).toBe("가YX나");

    await page.getByRole("button", { name: "전송", exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]!.message).toBe("가YX나");
  });

  test("copy and paste, selection replace and cut keep the model consistent", async ({ page }) => {
    await openChat(page, DESKTOP);
    await createShortcut(page, { name: "정리", content: CLEAN_BODY });
    const posts = await captureChatPosts(page);

    await composer(page).click();
    await insertViaDock(page, /정리/);
    await page.keyboard.type("뒤");
    const copied = await composer(page).inputValue();
    await page.keyboard.press("End");
    await composer(page).evaluate((el, text) => {
      (el as HTMLTextAreaElement).focus();
      document.execCommand("insertText", false, text);
    }, copied);
    await expect(chips(page)).toHaveCount(2);
    await composer(page).evaluate((el, text) => {
      (el as HTMLTextAreaElement).focus();
      document.execCommand("insertText", false, text);
    }, "붙\u2060\u200B\u200C여\u2061넣기");
    await expect(chips(page)).toHaveCount(2);
    expect(await composerVisibleText(page)).toMatch(/붙여넣기$/);

    await page.keyboard.press("Control+A");
    await page.keyboard.type("교체");
    await expect(chips(page)).toHaveCount(0);
    expect(await composerVisibleText(page)).toBe("교체");

    await page.getByRole("button", { name: "전송", exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]!.message).toBe("교체");
  });

  test("a later edit or delete of the shortcut never changes a chip already in the composer", async ({ page }) => {
    await openChat(page, DESKTOP);
    await createShortcut(page, { name: "정리", description: "원본", content: CLEAN_BODY });
    const posts = await captureChatPosts(page);

    await composer(page).click();
    await insertViaDock(page, /정리/);

    await page.getByTestId("chat-shortcuts-open").click();
    await panel(page).getByRole("button", { name: /정리/ }).first().click();
    await panel(page).getByRole("button", { name: "수정" }).click();
    await page.getByTestId("chat-shortcuts-content").fill("완전히 바뀐 본문");
    await page.getByTestId("chat-shortcuts-save").click();
    await expect(page.getByTestId("chat-shortcuts-preview")).toBeVisible();
    await panel(page).getByRole("button", { name: "삭제" }).click();
    await page.getByTestId("chat-shortcuts-delete-confirm").click();
    await page.getByTestId("chat-shortcuts-close").click();

    await page.getByRole("button", { name: "전송", exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]!.message).toBe(CLEAN_BODY);
  });

  test("expanded length over the chat limit is refused, never sliced", async ({ page }) => {
    await openChat(page, DESKTOP);
    const big = "나".repeat(500);
    await createShortcut(page, { name: "큰본문", content: big });
    const posts = await captureChatPosts(page);

    await composer(page).click();
    await insertViaDock(page, /큰본문/);
    await appendToComposer(page, "가".repeat(1000));
    await expect(chips(page)).toHaveCount(1);
    await expect(page.getByTestId("chat-composer-length")).toHaveText(/1,500 \/ 1,500자/);
    const before = await composer(page).inputValue();

    await appendToComposer(page, "다");
    await expect(page.getByTestId("chat-shortcuts-composer-notice")).toContainText("제한을 넘어");
    expect(await composer(page).inputValue()).toBe(before);

    await page.getByTestId("chat-shortcuts-open").click();
    await panel(page).getByRole("button", { name: /큰본문/ }).first().click();
    await page.getByTestId("chat-shortcuts-insert").click();
    await expect(page.getByTestId("chat-shortcuts-notice")).toContainText("입력 길이 제한");
    await expect(chips(page)).toHaveCount(1);
    await page.getByTestId("chat-shortcuts-close").click();

    await page.getByRole("button", { name: "전송", exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(String(posts[0]!.message)).toBe(`${big}${"가".repeat(1000)}`);
    expect(String(posts[0]!.message).length).toBe(1500);
  });

  test("failure restores the chips, in-flight input is locked, and reload keeps the draft per room", async ({
    page,
  }) => {
    await openChat(page, DESKTOP);
    await createShortcut(page, { name: "정리", content: CLEAN_BODY });
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bodies: Array<Record<string, unknown>> = [];
    await page.route("**/api/chat", async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || new URL(request.url()).pathname !== "/api/chat") {
        await route.continue();
        return;
      }
      bodies.push(JSON.parse(request.postData() ?? "{}") as Record<string, unknown>);
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "테스트 실패" }),
      });
    });

    await composer(page).click();
    await page.keyboard.type("앞 ");
    await insertViaDock(page, /정리/);
    await page.getByRole("button", { name: "전송", exact: true }).click();
    await expect(composer(page)).toBeDisabled();
    await expect(chips(page)).toHaveCount(0);
    await page.getByTestId("chat-shortcuts-open").click();
    await panel(page).getByRole("button", { name: /정리/ }).first().click();
    await expect(page.getByTestId("chat-shortcuts-insert")).toBeDisabled();
    await page.getByTestId("chat-shortcuts-close").click();
    release?.();

    await expect(composer(page)).toBeEnabled();
    await expect(chips(page)).toHaveCount(1);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.message).toBe(`앞 ${CLEAN_BODY}`);
    expect(await composerVisibleText(page)).toMatch(/^앞 .*정리.*$/);

    await page.reload();
    await expect(composer(page)).toBeVisible({ timeout: 45_000 });
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first()).toHaveAttribute("data-chip-name", "정리");
  });

  test("a chip draft does not leak into another room", async ({ page }) => {
    await openChat(page, DESKTOP);
    await createShortcut(page, { name: "정리", content: CLEAN_BODY });
    await composer(page).click();
    await insertViaDock(page, /정리/);
    await expect(chips(page)).toHaveCount(1);

    const other = await page.evaluate(async () => {
      const res = await fetch("/api/chat/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: 3, fresh: true }),
      });
      return ((await res.json()) as { chatId: number }).chatId;
    });
    await page.goto(`/chat/3?chat=${other}`, { waitUntil: "domcontentloaded" });
    await expect(composer(page)).toBeVisible({ timeout: 45_000 });
    await expect(composer(page)).toHaveValue("");
    await expect(chips(page)).toHaveCount(0);
  });
});

test.describe("slash autocomplete", () => {
  test("/ lists shortcuts and /ㅈ filters by initial consonant, name and description only", async ({ page }) => {
    await openChat(page, DESKTOP);
    await seedSlashLibrary(page);
    const posts = await captureChatPosts(page);

    await composer(page).click();
    await page.keyboard.type("/");
    await expect(slashMenu(page)).toBeVisible();
    await expect(slashOptions(page)).toHaveCount(4);
    await expect(slashOptions(page).first()).toContainText("★ 자동");

    await page.keyboard.type("ㅈ");
    await expect(slashOptions(page)).toHaveCount(3);
    await expect(slashOptions(page).nth(0)).toContainText("자동");
    await expect(slashOptions(page).nth(1)).toContainText("전투 진행");
    await expect(slashOptions(page).nth(2)).toContainText("진행");
    await expect(slashOptions(page).nth(2)).toContainText("장면을 이어서 진행");
    await expect(slashMenu(page)).not.toContainText("다음 장면을");
    await expect(slashMenu(page)).not.toContainText("진행 본문");

    await page.keyboard.press("Backspace");
    await page.keyboard.type("진");
    await expect(slashOptions(page)).toHaveCount(1);
    await expect(slashOptions(page).first()).toContainText("진행");

    await page.keyboard.press("Backspace");
    await page.keyboard.type("ㅋ");
    await expect(page.getByTestId("chat-shortcut-slash-empty")).toHaveText("일치하는 단축어 없음");
    await page.keyboard.press("Enter");
    await expect(composer(page)).toHaveValue("/ㅋ\n");
    expect(posts).toHaveLength(0);
  });

  test("arrow keys, Enter and Tab insert the highlighted chip; Escape only closes", async ({ page }) => {
    await openChat(page, DESKTOP);
    await seedSlashLibrary(page);
    const posts = await captureChatPosts(page);

    await composer(page).click();
    await page.keyboard.type("앞 /ㅈ");
    await expect(slashOptions(page)).toHaveCount(3);
    await expect(slashOptions(page).nth(0)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(slashOptions(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(slashOptions(page).nth(0)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(slashOptions(page).nth(2)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");

    await page.keyboard.press("Escape");
    await expect(slashMenu(page)).toHaveCount(0);
    await expect(composer(page)).toHaveValue("앞 /ㅈ");
    await expect(chips(page)).toHaveCount(0);

    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await expect(slashMenu(page)).toHaveCount(0);
    await page.keyboard.type("/ㅈ");
    await expect(slashMenu(page)).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(slashMenu(page)).toHaveCount(0);
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first()).toHaveAttribute("data-chip-name", "전투 진행");
    expect(posts).toHaveLength(0);
    await page.keyboard.type(" 뒤");

    await page.keyboard.type(" /진");
    await expect(slashOptions(page)).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect(chips(page)).toHaveCount(2);
    await expect(composer(page)).toBeFocused();
    expect(posts).toHaveLength(0);

    await page.getByRole("button", { name: "전송", exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]!.message).toBe("앞 전투 진행 본문 뒤 진행 본문 첫째");
  });

  test("a slash inside a URL or a word is plain text, and a mid-text command keeps its neighbours", async ({
    page,
  }) => {
    await openChat(page, DESKTOP);
    await seedSlashLibrary(page);
    const posts = await captureChatPosts(page);

    await composer(page).click();
    await page.keyboard.type("https://example.com/path and/or 1/2");
    await expect(slashMenu(page)).toHaveCount(0);

    await composer(page).fill("앞문장 뒷문장");
    await composer(page).evaluate((el) => (el as HTMLTextAreaElement).setSelectionRange(4, 4));
    await page.keyboard.type("/인");
    await expect(slashOptions(page)).toHaveCount(1);
    await slashOptions(page).first().click();
    await expect(chips(page)).toHaveCount(1);
    expect(await composerVisibleText(page)).toMatch(/^앞문장.*인사.*뒷문장$/);
    await page.getByRole("button", { name: "전송", exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]!.message).toBe("앞문장 인사 본문뒷문장");
  });

  test("Hangul composition never selects or sends; results follow after it commits", async ({ page }) => {
    await openChat(page, DESKTOP);
    await seedSlashLibrary(page);
    const posts = await captureChatPosts(page);
    const box = composer(page);

    await box.click();
    await page.keyboard.type("/");
    await box.evaluate((el) => {
      const textarea = el as HTMLTextAreaElement;
      textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, "/ㅈ");
      textarea.setSelectionRange(2, 2);
      textarea.dispatchEvent(
        new InputEvent("input", { bubbles: true, data: "ㅈ", inputType: "insertCompositionText", isComposing: true })
      );
    });
    await expect(slashOptions(page)).toHaveCount(3);
    await box.evaluate((el) => {
      for (const key of ["ArrowDown", "Enter", "Tab"]) {
        el.dispatchEvent(
          new KeyboardEvent("keydown", { key, keyCode: 229, isComposing: true, bubbles: true, cancelable: true })
        );
      }
    });
    await expect(chips(page)).toHaveCount(0);
    await expect(slashOptions(page).nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(box).toHaveValue("/ㅈ");

    await box.evaluate((el) => {
      const textarea = el as HTMLTextAreaElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, "/진");
      textarea.setSelectionRange(2, 2);
      textarea.dispatchEvent(
        new InputEvent("input", { bubbles: true, data: "진", inputType: "insertCompositionText", isComposing: true })
      );
      textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "진" }));
    });
    await expect(slashOptions(page)).toHaveCount(1);
    await expect(slashOptions(page).first()).toContainText("진행");
    await page.keyboard.press("Enter");
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first()).toHaveAttribute("data-chip-name", "진행");
    expect(posts).toHaveLength(0);
  });

  test("mouse click inserts a candidate without sending", async ({ page }) => {
    await openChat(page, DESKTOP);
    await seedSlashLibrary(page);
    const posts = await captureChatPosts(page);
    await composer(page).click();
    await page.keyboard.type("/ㅇ");
    await expect(slashOptions(page)).toHaveCount(1);
    await slashOptions(page).first().click();
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first()).toHaveAttribute("data-chip-name", "인사");
    await expect(composer(page)).toBeFocused();
    expect(posts).toHaveLength(0);
  });
});

test.describe("composer layout with chips", () => {
  for (const viewport of [
    { width: 320, height: 640, tag: "320" },
    { width: 390, height: 844, tag: "390" },
    { width: 1280, height: 800, tag: "1280" },
  ] as const) {
    test(`chip pill sits on the textarea label and nothing overflows at ${viewport.tag}`, async ({ page }, testInfo) => {
      await openChat(page, viewport);
      await seedSlashLibrary(page);
      await createShortcut(page, {
        name: "서른 글자까지 허용되는 아주 긴 단축어 이름 입니다",
        content: "긴 이름 본문",
      });

      await composer(page).click();
      await page.keyboard.type("안녕하세요 오늘은 ");
      await insertViaDock(page, /^★ 자동/);
      await page.keyboard.type(" 그리고 이어서 천천히 진행해 주세요 ");
      await insertViaDock(page, /^서른 글자까지/);
      await page.keyboard.type(" 끝입니다 끝입니다 끝입니다 끝입니다 끝입니다");
      await expect(chips(page)).toHaveCount(2);
      await settle(page);

      const geometry = await page.evaluate(() => {
        const textarea = document.querySelector("textarea[placeholder*='메시지 입력']") as HTMLTextAreaElement;
        const box = textarea.getBoundingClientRect();
        const rects = Array.from(document.querySelectorAll("[data-testid='chat-shortcut-chip']")).map((el) => {
          const rect = el.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        });
        return {
          box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
          rects,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      for (const rect of geometry.rects) {
        expect(rect.left).toBeGreaterThanOrEqual(geometry.box.left - 1);
        expect(rect.right).toBeLessThanOrEqual(geometry.box.right + 1);
      }
      expect(geometry.overflow).toBeLessThanOrEqual(0);
      await shot(page, testInfo, `chips-composer-${viewport.tag}`);

      await composer(page).evaluate((el) => {
        (el as HTMLTextAreaElement).scrollTop = 0;
      });
      const target = page.getByTestId("chat-shortcut-chip-remove").first();
      await target.scrollIntoViewIfNeeded();
      const hit = await target.boundingBox();
      expect(hit).not.toBeNull();
      await target.click();
      await expect(chips(page)).toHaveCount(1);
    });
  }
});

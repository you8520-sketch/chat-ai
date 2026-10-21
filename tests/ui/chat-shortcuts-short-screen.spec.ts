import { writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import {
  assertNoHorizontalOverflow,
  composer,
  openChat,
  openPanelWithManyShortcuts,
  panel,
  selectLongShortcut,
  settle,
  shot,
} from "./helpers/chatShortcutsUi";

type Reach = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  viewTop: number;
  viewBottom: number;
  inView: boolean;
  hit: boolean;
};

type PanelFrame = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  viewTop: number;
  viewBottom: number;
  composerTop: number;
  placement: string | null;
};

async function installFakeVisualViewport(page: Page) {
  await page.evaluate(() => {
    const fake = Object.assign(new EventTarget(), {
      width: window.innerWidth,
      height: window.innerHeight,
      offsetTop: 0,
      offsetLeft: 0,
      scale: 1,
    });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: fake });
    (window as unknown as { __fakeVisualViewport: typeof fake }).__fakeVisualViewport = fake;
  });
}

async function setFakeVisualViewport(page: Page, next: { height: number; offsetTop: number }) {
  await page.evaluate((value) => {
    const fake = (
      window as unknown as { __fakeVisualViewport: EventTarget & { height: number; offsetTop: number } }
    ).__fakeVisualViewport;
    fake.height = value.height;
    fake.offsetTop = value.offsetTop;
    fake.dispatchEvent(new Event("resize"));
    fake.dispatchEvent(new Event("scroll"));
  }, next);
  await settle(page);
}

async function reach(locator: Locator): Promise<Reach> {
  return locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const vv = window.visualViewport;
    const viewTop = vv ? vv.offsetTop : 0;
    const viewBottom = viewTop + (vv ? vv.height : window.innerHeight);
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      viewTop,
      viewBottom,
      inView:
        rect.top >= viewTop - 0.5 &&
        rect.bottom <= viewBottom + 0.5 &&
        rect.left >= -0.5 &&
        rect.right <= window.innerWidth + 0.5,
      hit: !!hit && (hit === el || el.contains(hit)),
    };
  });
}

async function panelFrame(page: Page): Promise<PanelFrame> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-testid='chat-shortcuts-panel']")!;
    const rect = el.getBoundingClientRect();
    const vv = window.visualViewport;
    const viewTop = vv ? vv.offsetTop : 0;
    const textarea = document.querySelector("textarea[placeholder*='메시지 입력']")!;
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      viewTop,
      viewBottom: viewTop + (vv ? vv.height : window.innerHeight),
      composerTop: textarea.getBoundingClientRect().top,
      placement: el.getAttribute("data-placement"),
    };
  });
}

async function expectPanelInsideVisibleViewport(page: Page) {
  const frame = await panelFrame(page);
  const width = await page.evaluate(() => window.innerWidth);
  expect.soft(frame.top, "panel top stays inside the visible viewport").toBeGreaterThanOrEqual(frame.viewTop - 0.5);
  expect.soft(frame.bottom, "panel bottom stays inside the visible viewport").toBeLessThanOrEqual(frame.viewBottom + 0.5);
  expect.soft(frame.left).toBeGreaterThanOrEqual(-0.5);
  expect.soft(frame.right).toBeLessThanOrEqual(width + 0.5);
  return frame;
}

async function expectReachable(locator: Locator, label: string) {
  const result = await reach(locator);
  expect.soft(result.inView, `${label} is inside the visible viewport`).toBe(true);
  expect.soft(result.hit, `${label} is not covered by another element`).toBe(true);
  return result;
}

async function record(testInfo: TestInfo, key: string, value: unknown) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(testInfo.outputPath(`measurements-${key}.json`), body);
}

async function openForm(page: Page) {
  await selectLongShortcut(page);
  await panel(page).getByRole("button", { name: "수정" }).click();
  await expect(page.getByTestId("chat-shortcuts-name")).toBeVisible();
}

test.describe.configure({ timeout: 90_000 });

test.describe("shortcut button row under the composer", () => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 1280, height: 800 },
  ]) {
    test(`does not overlap the textarea and matches the adjacent button at ${viewport.width}`, async ({
      page,
    }, testInfo) => {
      await openChat(page, viewport);
      const opener = page.getByTestId("chat-shortcuts-open");
      const toggle = page.getByRole("switch", { name: "추천 메시지" });
      await opener.scrollIntoViewIfNeeded();
      await settle(page);

      const row = await page.evaluate(() => {
        const open = document.querySelector<HTMLElement>("[data-testid='chat-shortcuts-open']")!;
        const toggleEl = document.querySelector<HTMLElement>("button[role='switch'][aria-label='추천 메시지']")!;
        const textarea = document.querySelector<HTMLElement>("textarea[placeholder*='메시지 입력']")!;
        let frame: HTMLElement = textarea;
        for (let el: HTMLElement | null = textarea; el && el !== document.body; el = el.parentElement) {
          if (Number.parseFloat(getComputedStyle(el).borderTopWidth) > 0) {
            frame = el;
            break;
          }
        }
        const baseline = (el: HTMLElement) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return range.getBoundingClientRect().bottom;
        };
        const rect = (el: HTMLElement) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, height: r.height, width: r.width };
        };
        const style = (el: HTMLElement) => {
          const s = getComputedStyle(el);
          return { fontSize: s.fontSize, marginTop: s.marginTop, marginBottom: s.marginBottom };
        };
        return {
          textarea: rect(textarea),
          frame: rect(frame),
          open: { ...rect(open), ...style(open), textBottom: baseline(open) },
          toggle: { ...rect(toggleEl), ...style(toggleEl), textBottom: baseline(toggleEl) },
        };
      });
      const gap = row.open.top - row.frame.bottom;
      await record(testInfo, `row-${viewport.width}`, { ...row, gapToComposerFrame: gap });
      await page.screenshot({ path: testInfo.outputPath(`row-${viewport.width}.png`) });

      expect.soft(Number.parseFloat(row.open.marginTop)).toBeGreaterThanOrEqual(0);
      expect.soft(Number.parseFloat(row.toggle.marginTop)).toBeGreaterThanOrEqual(0);
      expect.soft(row.open.top, "button stays below the textarea border").toBeGreaterThanOrEqual(row.textarea.bottom + 4);
      expect.soft(gap, "gap to the composer border").toBeGreaterThanOrEqual(2);
      expect.soft(Math.abs(row.open.height - row.toggle.height)).toBeLessThanOrEqual(0.5);
      expect.soft(Math.abs(row.open.top - row.toggle.top)).toBeLessThanOrEqual(0.5);
      expect.soft(row.open.fontSize).toBe(row.toggle.fontSize);
      expect.soft(Math.abs(row.open.textBottom - row.toggle.textBottom)).toBeLessThanOrEqual(0.5);
      if (viewport.width < 576) expect.soft(row.open.height).toBeGreaterThanOrEqual(32);

      const before = await toggle.getAttribute("aria-checked");
      await toggle.click();
      await expect(toggle).not.toHaveAttribute("aria-checked", before ?? "");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", before ?? "");
      await assertNoHorizontalOverflow(page);
    });
  }
});

test.describe("shortcut panel on short screens (667x375)", () => {
  const viewport = { width: 667, height: 375 };

  test("keeps list, preview, and form inside the screen with actions reachable", async ({ page }, testInfo) => {
    await openChat(page, viewport);
    await openPanelWithManyShortcuts(page);
    await settle(page);

    const list = await expectPanelInsideVisibleViewport(page);
    await expectReachable(page.getByTestId("chat-shortcuts-close"), "닫기 (list)");
    await shot(page, testInfo, "short-01-list-667x375");

    await selectLongShortcut(page);
    await settle(page);
    const preview = await expectPanelInsideVisibleViewport(page);
    const insert = await expectReachable(page.getByTestId("chat-shortcuts-insert"), "입력창에 넣기");
    await expectReachable(page.getByTestId("chat-shortcuts-close"), "닫기 (preview)");
    await shot(page, testInfo, "short-02-preview-667x375");

    await panel(page).getByRole("button", { name: "수정" }).click();
    await expect(page.getByTestId("chat-shortcuts-name")).toBeVisible();
    await settle(page);
    const form = await expectPanelInsideVisibleViewport(page);
    const save = await expectReachable(page.getByTestId("chat-shortcuts-save"), "저장");
    await expectReachable(page.getByTestId("chat-shortcuts-cancel"), "취소");
    await expectReachable(page.getByTestId("chat-shortcuts-close"), "닫기 (form)");
    await shot(page, testInfo, "short-03-form-667x375");

    await record(testInfo, "short-667x375", { list, preview, form, insert, save });
    await assertNoHorizontalOverflow(page);

    await page.getByTestId("chat-shortcuts-name").fill("짧은 화면 저장");
    await page.getByTestId("chat-shortcuts-save").click();
    await expect(page.getByTestId("chat-shortcuts-preview")).toContainText("짧은 화면 저장");
    await page.getByTestId("chat-shortcuts-insert").click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByTestId("chat-shortcut-chip")).toHaveAttribute("data-chip-name", "짧은 화면 저장");
  });

  test("real viewport shrink when the keyboard opens keeps the panel on screen", async ({ page }, testInfo) => {
    await openChat(page, viewport);
    await openPanelWithManyShortcuts(page);
    await openForm(page);
    await page.getByTestId("chat-shortcuts-name").focus();

    const frames: Record<string, unknown> = {};
    for (const height of [250, 200, 170]) {
      await page.setViewportSize({ width: viewport.width, height });
      await settle(page);
      const frame = await expectPanelInsideVisibleViewport(page);
      const close = await expectReachable(page.getByTestId("chat-shortcuts-close"), `닫기 @${height}`);
      const save = await expectReachable(page.getByTestId("chat-shortcuts-save"), `저장 @${height}`);
      const cancel = await expectReachable(page.getByTestId("chat-shortcuts-cancel"), `취소 @${height}`);
      frames[`height-${height}`] = { frame, close, save, cancel };
      await shot(page, testInfo, `keyboard-resize-form-${viewport.width}x${height}`);
    }
    await assertNoHorizontalOverflow(page);

    await page.setViewportSize(viewport);
    await settle(page);
    frames["restored-375"] = await expectPanelInsideVisibleViewport(page);
    await expect(page.getByTestId("chat-shortcuts-name")).toBeVisible();
    await record(testInfo, "keyboard-resize", frames);
  });

  test("visualViewport keyboard simulation (resize and pan) keeps the panel on screen", async ({
    page,
  }, testInfo) => {
    await openChat(page, viewport);
    await installFakeVisualViewport(page);
    await openPanelWithManyShortcuts(page);
    await selectLongShortcut(page);

    const frames: Record<string, unknown> = {};
    for (const state of [
      { height: 375, offsetTop: 0, tag: "closed-keyboard" },
      { height: 200, offsetTop: 0, tag: "keyboard-200" },
      { height: 200, offsetTop: 60, tag: "keyboard-200-panned-60" },
      { height: 170, offsetTop: 90, tag: "keyboard-170-panned-90" },
    ]) {
      await setFakeVisualViewport(page, state);
      const frame = await expectPanelInsideVisibleViewport(page);
      const close = await expectReachable(page.getByTestId("chat-shortcuts-close"), `닫기 ${state.tag}`);
      const insert = await expectReachable(page.getByTestId("chat-shortcuts-insert"), `입력창에 넣기 ${state.tag}`);
      frames[state.tag] = { ...state, frame, close, insert };
      await shot(page, testInfo, `keyboard-vv-preview-${state.tag}`);
    }

    await panel(page).getByRole("button", { name: "수정" }).click();
    await expect(page.getByTestId("chat-shortcuts-name")).toBeVisible();
    for (const state of [
      { height: 200, offsetTop: 60, tag: "form-keyboard-200-panned-60" },
      { height: 170, offsetTop: 0, tag: "form-keyboard-170" },
    ]) {
      await setFakeVisualViewport(page, state);
      const frame = await expectPanelInsideVisibleViewport(page);
      const save = await expectReachable(page.getByTestId("chat-shortcuts-save"), `저장 ${state.tag}`);
      const cancel = await expectReachable(page.getByTestId("chat-shortcuts-cancel"), `취소 ${state.tag}`);
      const close = await expectReachable(page.getByTestId("chat-shortcuts-close"), `닫기 ${state.tag}`);
      frames[state.tag] = { ...state, frame, save, cancel, close };
      await shot(page, testInfo, `keyboard-vv-${state.tag}`);
    }
    await record(testInfo, "keyboard-visual-viewport", frames);
  });
});

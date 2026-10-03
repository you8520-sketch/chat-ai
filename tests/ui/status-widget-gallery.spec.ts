import fs from "node:fs";
import { expect, test } from "@playwright/test";

import { buildBuiltinStatusWidgetTemplate } from "../../src/lib/statusWidget/builtinTemplates";
import { DEFAULT_STATUS_WIDGET } from "../../src/lib/statusWidget/defaultTemplate";
import { renderStatusWidgetHtml } from "../../src/lib/statusWidget/render";
import { serializeStatusWidget } from "../../src/lib/statusWidget/serialize";
import type { StatusWidget, StatusWidgetField } from "../../src/lib/statusWidget/types";

const LONG_KOREAN = "가나다라마바사아자차카타파하".repeat(12);

const PUBLIC_JSX_WIDGET: StatusWidget = {
  version: 1,
  name: "공개 JSX",
  htmlTemplate: "",
  jsxSource: `export default function PublicGalleryPreview() {
    useEffect(() => { sendToChat("gallery-auto-send-must-stay-local"); }, []);
    return <div>PUBLIC_JSX_READY</div>;
  }`,
  fields: [{ id: "시간", label: "시간", instruction: "현재 시각" }],
  placement: "bottom",
};

function rendered(id: "clean" | "compact") {
  const numeric: StatusWidgetField = {
    id: "호감도",
    label: "호감도",
    instruction: "정수",
    numericState: {
      version: 1,
      mode: "server_meter",
      min: 0,
      max: 100,
      initial: 1,
      integer: true,
    },
  };
  const fields: StatusWidgetField[] = [
    ...DEFAULT_STATUS_WIDGET.fields,
    { id: "소지품", label: "소지품", instruction: "소지품" },
    numeric,
  ];
  const widget = buildBuiltinStatusWidgetTemplate(id, fields);
  return renderStatusWidgetHtml(widget, {
    시간: "23:59",
    장소: LONG_KOREAN,
    현재상황: LONG_KOREAN,
    현재목표: LONG_KOREAN,
    속마음: LONG_KOREAN,
    소지품: LONG_KOREAN,
    호감도: "87",
  });
}

test("built-in status widgets fit a 320px column and the gallery does not call chat", async ({
  page,
}) => {
  const providerCalls: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/\/api\/chat|openrouter\.ai|api\.openai\.com/i.test(url)) providerCalls.push(url);
  });

  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");

  for (const id of ["clean", "compact"] as const) {
    const overflow = await page.evaluate((html) => {
      document.getElementById("sw-probe")?.remove();
      const host = document.createElement("div");
      host.id = "sw-probe";
      host.style.cssText = "width:320px;max-width:320px;min-width:0;box-sizing:border-box;";
      host.innerHTML = html;
      document.body.appendChild(host);
      const card = host.firstElementChild as HTMLElement | null;
      const hostOverflow = host.scrollWidth - host.clientWidth;
      const cardOverflow = card ? card.scrollWidth - card.clientWidth : 0;
      return { hostOverflow, cardOverflow, text: card?.textContent ?? "" };
    }, rendered(id));
    expect(overflow.hostOverflow, id).toBeLessThanOrEqual(1);
    expect(overflow.cardOverflow, id).toBeLessThanOrEqual(1);
    expect(overflow.text).toContain("23:59");
    expect(overflow.text).toContain("87");
  }

  // Production session cookies are Secure. The page keeps them on
  // http://127.0.0.1; Playwright's API client does not send them back.
  const loginStatus = await page.evaluate(async () => {
    const res = await fetch("/api/auth/demo-login", { method: "POST" });
    return res.status;
  });
  expect(loginStatus).toBe(200);
  const shareResult = await page.evaluate(async (body) => {
    const res = await fetch("/api/status-widget-shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, text: await res.text() };
  }, {
    title: "공개 JSX 안전 미리보기",
    widget_json: serializeStatusWidget(PUBLIC_JSX_WIDGET),
    visibility: "public",
  });
  expect(shareResult.status, shareResult.text).toBe(200);

  await page.goto("/widgets");
  await expect(page.getByRole("heading", { name: "공유 상태창" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "인기순" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "최신순" })).toBeVisible();

  const card = page
    .getByRole("heading", { name: "공개 JSX 안전 미리보기" })
    .locator("xpath=ancestor::li");
  await expect(card.getByRole("button", { name: "JSX 미리보기 열기" })).toBeVisible();
  await expect(card.locator('iframe[title="status-widget-preview"]')).toHaveCount(0);
  expect(providerCalls).toEqual([]);

  await card.getByRole("button", { name: "JSX 미리보기 열기" }).click();
  await expect(card.locator('iframe[title="status-widget-preview"]')).toHaveCount(1);
  await expect(card.frameLocator('iframe[title="status-widget-preview"]').getByText("PUBLIC_JSX_READY")).toBeVisible();
  expect(providerCalls).toEqual([]);
});

test("new character authoring tabs keep code across tab moves at 390px", async ({ page }) => {
  const providerCalls: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/\/api\/chat|openrouter\.ai|api\.openai\.com/i.test(url)) providerCalls.push(url);
  });

  const login = await page.request.post("/api/auth/demo-login");
  expect(login.ok()).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/create");

  const pageTab = page.getByRole("tab", { name: "상태창", exact: true });
  await expect(pageTab).toBeVisible();
  await expect
    .poll(async () => {
      if ((await pageTab.getAttribute("aria-selected")) !== "true") await pageTab.click();
      return pageTab.getAttribute("aria-selected");
    })
    .toBe("true");

  const basic = page.getByRole("tab", { name: "기본 제작" });
  const direct = page.getByRole("tab", { name: "직접 제작" });
  await expect(basic).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: /클린 카드/ })).toBeVisible();
  await expect(page.getByText(/추정 토큰 \d[\d,]* \/ 600/)).toBeVisible();
  if (fs.existsSync("/opt/cursor/artifacts")) {
    await page.screenshot({ path: "/opt/cursor/artifacts/status-budget-600-mobile.png" });
  }

  const previewCopy = page.getByText("미리보기 · 채팅 전송은 꺼져 있습니다.");
  await expect(previewCopy).toBeVisible();
  const layout = await previewCopy.evaluate((node) => {
    const box = node.nextElementSibling as HTMLElement | null;
    const fields = Array.from(document.querySelectorAll("span")).find((el) =>
      el.textContent?.includes("① 상태값")
    );
    const style = box ? getComputedStyle(box) : null;
    return {
      previewBeforeFields:
        Boolean(box) &&
        Boolean(fields) &&
        box!.getBoundingClientRect().top < fields!.getBoundingClientRect().top,
      maxHeight: style?.maxHeight ?? "",
      overflowY: style?.overflowY ?? "",
      hasIframe: Boolean(box?.querySelector("iframe")),
    };
  });
  expect(layout.previewBeforeFields).toBe(true);
  expect(layout.maxHeight).toBe("240px");
  expect(layout.overflowY).toBe("auto");
  expect(layout.hasIframe).toBe(false);

  const timeInput = page.locator('input[value="시간"]');
  await timeInput.fill("장면시각");
  await direct.click();
  await expect(direct).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: /HTML 직접 제작/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /JSX 직접 제작/ })).toBeVisible();
  await expect(page.getByPlaceholder(/export default function StatusWidgetView/)).toHaveCount(0);
  await basic.click();
  await expect(page.locator('input[value="장면시각"]')).toHaveValue("장면시각");

  await direct.click();
  await page.getByRole("button", { name: /JSX 직접 제작/ }).click();
  const code = page.getByPlaceholder(/export default function StatusWidgetView/);
  await expect(code).toBeVisible();
  const source = await code.inputValue();
  const marked = `${source}\n// keep-me`;
  await code.fill(marked);
  await basic.click();
  await direct.click();
  await expect(code).toHaveValue(marked);

  await basic.click();
  await page.getByRole("button", { name: /클린 카드/ }).click();
  const dialog = page.getByRole("alertdialog", { name: "제작 내용 변경 확인" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "취소" }).click();
  await direct.click();
  await expect(code).toHaveValue(marked);
  await expect(page.locator('iframe[title="status-widget-preview"]')).toHaveCount(1);
  expect(providerCalls).toEqual([]);
});

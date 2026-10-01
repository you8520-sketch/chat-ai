import { expect, test } from "@playwright/test";

import { buildBuiltinStatusWidgetTemplate } from "../../src/lib/statusWidget/builtinTemplates";
import { DEFAULT_STATUS_WIDGET } from "../../src/lib/statusWidget/defaultTemplate";
import { renderStatusWidgetHtml } from "../../src/lib/statusWidget/render";
import type { StatusWidgetField } from "../../src/lib/statusWidget/types";

const LONG_KOREAN = "가나다라마바사아자차카타파하".repeat(12);

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

  await page.goto("/widgets");
  await expect(page.getByRole("heading", { name: "공유 상태창" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "인기순" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "최신순" })).toBeVisible();
  expect(providerCalls).toEqual([]);
});

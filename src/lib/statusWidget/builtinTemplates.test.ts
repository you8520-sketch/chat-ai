import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sanitizeChatVisualCardHtml } from "@/lib/chatHtmlSanitize";
import { compileJsxComponentSource } from "@/lib/jsxComponent/compile";
import { defaultStatusWidgetJsxSource } from "./jsxAuthoring";
import {
  BUILTIN_STATUS_WIDGET_TEMPLATES,
  buildBuiltinStatusWidgetTemplate,
  type BuiltinStatusWidgetTemplateId,
} from "./builtinTemplates";
import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import { renderStatusWidgetHtml } from "./render";
import type { StatusWidgetField } from "./types";

const IDS: BuiltinStatusWidgetTemplateId[] = ["clean", "compact"];

const INSTRUCTIONS = {
  시간: "현재 장면의 시각을 짧게 작성한다.",
  장소: "현재 장면의 장소를 짧게 작성한다.",
  현재상황: "지금 벌어지는 핵심 상황을 한 줄로 작성한다.",
  현재목표: "NPC가 지금 이루려는 단기 목표를 짧게 작성한다.",
  속마음: "NPC의 현재 내면을 자연스러운 1인칭 한 줄로 작성한다.",
} as const;

function assertResponsiveShell(html: string) {
  assert.match(html, /width:100%/);
  assert.match(html, /min-width:0/);
  assert.match(html, /max-width:100%/);
  assert.match(html, /overflow-wrap:anywhere/);
  assert.match(html, /\{\{char\}\}/);
  assert.doesNotMatch(html, /550px/);
  assert.doesNotMatch(html, /min-width:\s*max-content/i);
  assert.doesNotMatch(html, /width:\s*max-content/i);
  assert.doesNotMatch(html, /white-space:\s*nowrap/i);
  assert.doesNotMatch(html, /word-break:\s*keep-all/i);
  assert.doesNotMatch(html, /Pretendard|Orbitron|fonts\.google|SYSTEM OVERVIEW|STATUS REPORT/i);
  const safe = sanitizeChatVisualCardHtml(html);
  assert.match(safe, /width:100%/);
  assert.match(safe, /min-width:0/);
  assert.match(safe, /overflow-wrap:anywhere/);
  assert.doesNotMatch(safe, /550px/);
  assert.doesNotMatch(safe, /<script/i);
}

describe("genre-neutral built-in status widgets", () => {
  it("clean card is the default and keeps five concise fields", () => {
    assert.equal(BUILTIN_STATUS_WIDGET_TEMPLATES.clean.name, "클린 카드");
    assert.equal(DEFAULT_STATUS_WIDGET.name, "클린 카드");
    assert.deepEqual(
      DEFAULT_STATUS_WIDGET.fields.map((field) => field.label),
      ["시간", "장소", "현재상황", "현재목표", "속마음"]
    );
    for (const field of DEFAULT_STATUS_WIDGET.fields) {
      assert.equal(field.instruction, INSTRUCTIONS[field.label as keyof typeof INSTRUCTIONS]);
    }
    assert.equal(
      DEFAULT_STATUS_WIDGET.fields.some((field) => field.label === "의식의흐름"),
      false
    );
    const starter = compileJsxComponentSource(defaultStatusWidgetJsxSource(DEFAULT_STATUS_WIDGET.fields));
    assert.equal(starter.ok, true);
    if (starter.ok) assert.equal(starter.chatSend, false);
  });

  it("compact panel is a denser list and does not use the clean auto-fit grid", () => {
    const compact = BUILTIN_STATUS_WIDGET_TEMPLATES.compact;
    assert.equal(compact.name, "컴팩트 패널");
    assert.match(compact.htmlTemplate, /\{\{시간\}\} · \{\{장소\}\}/);
    assert.match(compact.htmlTemplate, /\{\{현재상황\}\}/);
    assert.doesNotMatch(compact.htmlTemplate, /grid-template-columns/);
    assert.match(BUILTIN_STATUS_WIDGET_TEMPLATES.clean.htmlTemplate, /grid-template-columns:repeat\(auto-fit,minmax\(9rem,1fr\)\)/);
    assert.match(
      sanitizeChatVisualCardHtml(BUILTIN_STATUS_WIDGET_TEMPLATES.clean.htmlTemplate),
      /grid-template-columns:repeat\(auto-fit,minmax\(9rem,1fr\)\)/
    );
  });

  it("both built-ins stay within a 320px-safe shell and survive the sanitizer", () => {
    for (const id of IDS) {
      assertResponsiveShell(BUILTIN_STATUS_WIDGET_TEMPLATES[id].htmlTemplate);
    }
  });

  it("renders added, removed, and numeric fields without a fixed width", () => {
    const numeric: StatusWidgetField = {
      id: "호감도",
      label: "호감도",
      instruction: "0에서 100 사이 정수",
      numericState: {
        version: 1,
        mode: "server_meter",
        min: 0,
        max: 100,
        initial: 10,
        integer: true,
      },
    };
    const fields: StatusWidgetField[] = [
      ...DEFAULT_STATUS_WIDGET.fields.filter((field) => field.id !== "현재목표"),
      { id: "소지품", label: "소지품", instruction: "가지고 있는 것" },
      numeric,
    ];
    for (const id of IDS) {
      const widget = buildBuiltinStatusWidgetTemplate(id, fields);
      assert.doesNotMatch(widget.htmlTemplate, /현재목표/);
      assert.match(widget.htmlTemplate, /\{\{소지품\}\}/);
      assert.match(widget.htmlTemplate, /font-variant-numeric:tabular-nums/);
      assert.match(widget.htmlTemplate, /0–100/);
      assert.equal(widget.htmlTemplate.split("font-variant-numeric:tabular-nums").length - 1, 1);
      assertResponsiveShell(widget.htmlTemplate);
      const html = renderStatusWidgetHtml(widget, {
        시간: "09:00",
        장소: "집",
        현재상황: "아침 식사를 마쳤다",
        속마음: "조용히 기다리고 싶다",
        소지품: "열쇠",
        호감도: "42",
      });
      assert.match(html, /09:00 · 집/);
      assert.match(html, /아침 식사를 마쳤다/);
      assert.match(html, /열쇠/);
      assert.match(html, /42/);
      assert.doesNotMatch(html, /550px/);
      assert.doesNotMatch(html, /\{\{/);
    }
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import { renderStatusWidgetHtml } from "./render";
import type { StatusWidget } from "./types";

const widgetWithStalePreview: StatusWidget = {
  ...DEFAULT_STATUS_WIDGET,
  fields: DEFAULT_STATUS_WIDGET.fields.map((field) => ({
    ...field,
    previewValue:
      field.id === "시간"
        ? "14:30"
        : field.id === "장소"
          ? "카페"
          : "…",
  })),
};

describe("renderStatusWidgetHtml previewValue fallback", () => {
  it("does not use previewValue when values are empty — all fields show —", () => {
    const html = renderStatusWidgetHtml(widgetWithStalePreview, {});
    assert.match(html, /— · —/);
    assert.doesNotMatch(html, /14:30/);
    assert.doesNotMatch(html, /카페/);
    assert.doesNotMatch(html, /…/);
  });

  it("uses AI-provided values when present", () => {
    const html = renderStatusWidgetHtml(widgetWithStalePreview, {
      시간: "09:00",
      장소: "집",
      속마음: "졸리다",
      현재상황: "아침",
    });
    assert.match(html, /09:00 · 집/);
    assert.match(html, /졸리다/);
    assert.match(html, /아침/);
    assert.doesNotMatch(html, /14:30/);
    assert.doesNotMatch(html, /카페/);
  });
});

describe("renderStatusWidgetHtml {{char}}/{{user}}", () => {
  it("expands profile placeholders in HTML template after field values", () => {
    const widget: StatusWidget = {
      ...DEFAULT_STATUS_WIDGET,
      htmlTemplate:
        `<div><b>{{char}}</b>/<i>{{user}}</i>{{속마음}}</div>`,
      fields: [
        { id: "속마음", label: "{{char}} 속마음", instruction: "{{char}}의 속마음" },
      ],
    };
    const html = renderStatusWidgetHtml(
      widget,
      { 속마음: "두근거린다" },
      { characterName: "라이크", personaName: "렌" }
    );
    assert.match(html, /라이크/);
    assert.match(html, /렌/);
    assert.match(html, /두근거린다/);
    assert.doesNotMatch(html, /\{\{char\}\}/i);
    assert.doesNotMatch(html, /\{\{user\}\}/i);
    assert.doesNotMatch(html, /\bNPC\b/);
    assert.doesNotMatch(html, /\bPC\b/);
  });

  it("coalesces bare NPC/PC field values to real names", () => {
    const widget: StatusWidget = {
      ...DEFAULT_STATUS_WIDGET,
      htmlTemplate: `<div>{{이름}}</div>`,
      fields: [{ id: "이름", label: "이름", instruction: "{{char}} 이름" }],
    };
    const html = renderStatusWidgetHtml(
      widget,
      { 이름: "NPC" },
      { characterName: "라이크", personaName: "렌" }
    );
    assert.match(html, /라이크/);
    assert.doesNotMatch(html, /\bNPC\b/);
  });
});

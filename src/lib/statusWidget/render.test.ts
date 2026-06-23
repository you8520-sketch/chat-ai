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

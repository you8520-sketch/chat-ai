import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import {
  buildStatusWidgetEditorPreviewValues,
  formatStatusWidgetEditorPreviewValue,
} from "./editorPreview";
import { renderStatusWidgetHtml } from "./render";

describe("formatStatusWidgetEditorPreviewValue", () => {
  it("wraps instruction text in parentheses", () => {
    assert.equal(
      formatStatusWidgetEditorPreviewValue({
        id: "x",
        label: "현재상황",
        instruction: "지금 벌어지는 상황을 한 줄로 요약.",
      }),
      "(지금 벌어지는 상황을 한 줄로 요약.)"
    );
  });

  it("falls back when instruction is empty", () => {
    assert.equal(
      formatStatusWidgetEditorPreviewValue({ id: "x", label: "시간", instruction: "" }),
      "(시간 — 지시사항 없음)"
    );
  });
});

describe("buildStatusWidgetEditorPreviewValues", () => {
  it("uses instruction text in layout preview", () => {
    const values = buildStatusWidgetEditorPreviewValues(DEFAULT_STATUS_WIDGET);
    assert.match(values["현재상황"] ?? "", /지금 벌어지는 상황을 한 줄로 요약/);
    const html = renderStatusWidgetHtml(DEFAULT_STATUS_WIDGET, values);
    assert.match(html, /지금 벌어지는 상황을 한 줄로 요약/);
    assert.match(html, /\(NPC의 속마음/);
    assert.doesNotMatch(html, /\{\{/);
  });
});

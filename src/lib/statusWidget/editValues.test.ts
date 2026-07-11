import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyEditableStatusWidgetValuePatch,
  renderEditableStatusWidgetHtml,
  writeEditableStatusWidgetValue,
} from "./editValues";
import type { StatusWidget } from "./types";

const widget: StatusWidget = {
  version: 1,
  name: "상태창",
  placement: "bottom",
  htmlTemplate:
    '<section style="color:#fff"><strong>시간</strong><span>{{시간}}</span><p>{{상황}}</p></section>',
  fields: [
    { id: "time", label: "시간", instruction: "현재 시각" },
    { id: "situation", label: "상황", instruction: "현재 상황" },
  ],
};

describe("status widget value editing", () => {
  it("keeps the original card HTML and makes only rendered values editable", () => {
    const html = renderEditableStatusWidgetHtml("character", widget, {
      시간: "밤 11시",
      상황: "문 앞에서 대기 중",
    });
    assert.match(html, /<section style="color:#fff">/);
    assert.match(html, /<strong>시간<\/strong>/);
    assert.equal((html.match(/contenteditable="plaintext-only"/g) ?? []).length, 2);
    assert.match(html, />밤 11시<\/span>/);
    assert.doesNotMatch(html, /<span[^>]*contenteditable[^>]*>시간<\/span>/);
  });

  it("escapes edited value text instead of treating it as HTML", () => {
    const html = renderEditableStatusWidgetHtml("character", widget, {
      시간: '<img src=x onerror="alert(1)">',
    });
    assert.doesNotMatch(html, /<img/i);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  });

  it("changes configured values only and preserves unknown stored metadata", () => {
    const patched = applyEditableStatusWidgetValuePatch(
      { time: "old", hidden_engine_value: "keep" },
      { 시간: "new", hacked_key: "blocked" },
      widget
    );
    assert.deepEqual(patched, {
      시간: "new",
      hidden_engine_value: "keep",
    });
  });

  it("can clear a displayed value without changing its field definition", () => {
    const next = writeEditableStatusWidgetValue(
      { 시간: "밤", hidden_engine_value: "keep" },
      widget.fields[0]!,
      ""
    );
    assert.deepEqual(next, { hidden_engine_value: "keep" });
    assert.equal(widget.fields[0]!.label, "시간");
    assert.equal(widget.fields[0]!.instruction, "현재 시각");
  });
});

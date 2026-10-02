import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate.ts";
import {
  ADVANCED_STATUS_WIDGET_CHOICES,
  applyStatusWidgetAuthoringChoice,
  BASIC_STATUS_WIDGET_CHOICES,
  detectStatusWidgetAuthoringChoice,
  isAdvancedStatusWidgetChoice,
  resetStatusWidgetAuthoring,
  STATUS_WIDGET_SHARED_DESIGN_LABEL,
} from "./authoringChoice.ts";

describe("status widget authoring choice", () => {
  it("keeps basic design as the default path and HTML/JSX as advanced", () => {
    assert.deepEqual(
      BASIC_STATUS_WIDGET_CHOICES.map((choice) => choice.id),
      ["clean", "compact"]
    );
    assert.deepEqual(
      ADVANCED_STATUS_WIDGET_CHOICES.map((choice) => choice.id),
      ["html", "jsx"]
    );
    assert.equal(isAdvancedStatusWidgetChoice("clean"), false);
    assert.equal(isAdvancedStatusWidgetChoice("jsx"), true);
    assert.equal(detectStatusWidgetAuthoringChoice(DEFAULT_STATUS_WIDGET), "clean");
  });

  it("preserves fields across design, HTML, and JSX switches", () => {
    const start = resetStatusWidgetAuthoring();
    const labeled = {
      ...start,
      fields: start.fields.map((field, index) =>
        index === 0 ? { ...field, label: "장면시각", instruction: "HH:MM" } : field
      ),
    };
    const compact = applyStatusWidgetAuthoringChoice(labeled, "compact");
    assert.equal(compact.fields[0]?.label, "장면시각");
    assert.equal(compact.fields[0]?.instruction, "HH:MM");
    assert.equal(compact.fields.length, start.fields.length);
    assert.equal(detectStatusWidgetAuthoringChoice(compact), "compact");
    assert.equal(compact.jsxSource, undefined);

    const jsx = applyStatusWidgetAuthoringChoice(compact, "jsx");
    assert.equal(jsx.fields[0]?.label, "장면시각");
    assert.match(jsx.jsxSource ?? "", /props\[/);
    assert.equal(jsx.htmlTemplate, compact.htmlTemplate);

    const html = applyStatusWidgetAuthoringChoice(jsx, "html");
    assert.equal(html.jsxSource, undefined);
    assert.equal(html.htmlTemplate, jsx.htmlTemplate);
    assert.equal(html.fields[0]?.instruction, "HH:MM");

    const back = applyStatusWidgetAuthoringChoice(html, "clean");
    assert.equal(back.fields[0]?.label, "장면시각");
    assert.equal(back.jsxSource, undefined);
    assert.equal(detectStatusWidgetAuthoringChoice(back), "clean");
  });

  it("keeps an existing JSX source when re-entering JSX mode", () => {
    const custom = "export default function StatusWidgetView(props) { return <b>{props['시간']}</b>; }";
    const widget = applyStatusWidgetAuthoringChoice(
      { ...resetStatusWidgetAuthoring(), jsxSource: custom },
      "jsx"
    );
    assert.equal(widget.jsxSource, custom);
  });

  it("points the shared-design entry at one label", () => {
    assert.equal(STATUS_WIDGET_SHARED_DESIGN_LABEL, "공유 디자인 가져오기");
    for (const path of [
      "src/components/StatusWidgetEditor.tsx",
      "src/components/CreateCharacter.tsx",
      "src/app/persona/PersonaClient.tsx",
    ]) {
      assert.match(readFileSync(path, "utf8"), /STATUS_WIDGET_SHARED_DESIGN_LABEL/);
    }
    const editor = readFileSync("src/components/StatusWidgetEditor.tsx", "utf8");
    assert.match(editor, /고급 편집/);
    assert.match(editor, /채팅 중 호출 컴포넌트와는 별개/);
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate.ts";
import { parseStatusWidgetJson, serializeStatusWidget } from "./serialize.ts";
import {
  ADVANCED_STATUS_WIDGET_CHOICES,
  applyStatusWidgetAuthoringChoice,
  authoringChoiceDiscardsPresentation,
  BASIC_STATUS_WIDGET_CHOICES,
  detectStatusWidgetAuthoringChoice,
  initialStatusWidgetAuthoringSurface,
  isAdvancedStatusWidgetChoice,
  resetStatusWidgetAuthoring,
  STATUS_WIDGET_AUTHORING_SURFACES,
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

  it("opens a new widget on basic authoring and custom HTML or JSX on direct", () => {
    assert.deepEqual(
      STATUS_WIDGET_AUTHORING_SURFACES.map((surface) => surface.label),
      ["기본 제작", "직접 제작"]
    );
    assert.deepEqual(
      ADVANCED_STATUS_WIDGET_CHOICES.map((choice) => choice.label),
      ["HTML 직접 제작", "JSX 직접 제작"]
    );
    assert.equal(initialStatusWidgetAuthoringSurface(DEFAULT_STATUS_WIDGET), "basic");
    assert.equal(initialStatusWidgetAuthoringSurface(resetStatusWidgetAuthoring()), "basic");

    const customHtml = {
      ...resetStatusWidgetAuthoring(),
      htmlTemplate: "<section>mine</section>",
    };
    assert.equal(detectStatusWidgetAuthoringChoice(customHtml), "html");
    assert.equal(initialStatusWidgetAuthoringSurface(customHtml), "direct");

    const jsx = applyStatusWidgetAuthoringChoice(resetStatusWidgetAuthoring(), "jsx");
    assert.equal(initialStatusWidgetAuthoringSurface(jsx), "direct");
  });

  it("keeps presentation unless an explicit choice would replace custom code", () => {
    const start = resetStatusWidgetAuthoring();
    assert.equal(authoringChoiceDiscardsPresentation(start, "compact"), false);
    assert.equal(authoringChoiceDiscardsPresentation(start, "jsx"), false);
    assert.equal(authoringChoiceDiscardsPresentation(start, "html"), false);

    const jsx = applyStatusWidgetAuthoringChoice(start, "jsx");
    const customSource = "export default function StatusWidgetView(props) { return <i>{props['시간']}</i>; }";
    const customJsx = { ...jsx, jsxSource: customSource };
    assert.equal(authoringChoiceDiscardsPresentation(customJsx, "jsx"), false);
    assert.equal(applyStatusWidgetAuthoringChoice(customJsx, "jsx").jsxSource, customSource);
    assert.equal(authoringChoiceDiscardsPresentation(customJsx, "html"), true);
    assert.equal(authoringChoiceDiscardsPresentation(customJsx, "clean"), true);

    const customHtml = { ...start, htmlTemplate: "<section>mine</section>" };
    assert.equal(authoringChoiceDiscardsPresentation(customHtml, "html"), false);
    assert.equal(authoringChoiceDiscardsPresentation(customHtml, "clean"), true);
    assert.equal(authoringChoiceDiscardsPresentation(customHtml, "compact"), true);
  });

  it("drops broken JSX on save and keeps the last HTML and fields", () => {
    const good = applyStatusWidgetAuthoringChoice(resetStatusWidgetAuthoring(), "jsx");
    const saved = parseStatusWidgetJson(serializeStatusWidget(good));
    assert.match(saved?.jsxSource ?? "", /StatusWidgetView/);
    assert.equal(saved?.htmlTemplate, good.htmlTemplate);

    const broken = { ...good, jsxSource: "this is not jsx <<<" };
    const savedBroken = parseStatusWidgetJson(serializeStatusWidget(broken));
    assert.equal(savedBroken?.jsxSource, undefined);
    assert.equal(savedBroken?.htmlTemplate, good.htmlTemplate);
    assert.equal(savedBroken?.fields[0]?.label, good.fields[0]?.label);
    assert.match(good.jsxSource ?? "", /StatusWidgetView/);
    assert.match(parseStatusWidgetJson(serializeStatusWidget(good))?.jsxSource ?? "", /StatusWidgetView/);
  });

  it("points the shared-design entry at one editor label and the caller's budget", () => {
    assert.equal(STATUS_WIDGET_SHARED_DESIGN_LABEL, "공유 디자인 가져오기");
    const editor = readFileSync("src/components/StatusWidgetEditor.tsx", "utf8");
    const persona = readFileSync("src/app/persona/PersonaClient.tsx", "utf8");
    const create = readFileSync("src/components/CreateCharacter.tsx", "utf8");
    assert.match(editor, /STATUS_WIDGET_SHARED_DESIGN_LABEL/);
    assert.match(persona, /STATUS_WIDGET_SHARED_DESIGN_LABEL/);
    assert.doesNotMatch(create, /STATUS_WIDGET_SHARED_DESIGN_LABEL/);
    assert.doesNotMatch(editor, /고급 편집/);
    assert.match(editor, /채팅 중 호출 컴포넌트와는 별개/);
    assert.match(editor, /onClick=\{\(\) => setSurface\(tab\.id\)\}/);
    assert.match(editor, /formatWidgetBudgetHint\(widgetReservedChars, contextLimit\)/);
    assert.match(editor, /max-h-60/);
    assert.match(persona, /contextLimit=\{STATUS_WIDGET_USER_CONTEXT_MAX\}/);
    assert.match(persona, /showSharedDesignEntry=\{false\}/);
    const previewAt = editor.indexOf("<StatusWidgetPreview");
    const fieldsAt = editor.indexOf("① 상태값 · ② 지시사항");
    assert.ok(previewAt > 0 && fieldsAt > previewAt);
    assert.equal(editor.split("<StatusWidgetPreview").length - 1, 1);
    assert.match(editor, /채팅 전송은 꺼져 있습니다/);
    assert.match(
      readFileSync("src/lib/statusWidget/previewRuntime.ts", "utf8"),
      /STATUS_WIDGET_PREVIEW_CHAT_SEND_ENABLED = false/
    );
    assert.match(readFileSync("src/lib/statusWidgetPresets.ts", "utf8"), /userReservedChars: reserved/);
    assert.match(
      readFileSync("src/lib/characterFormSave.ts", "utf8"),
      /validateCharacterStatusWidgetContextBudget/
    );
  });
});

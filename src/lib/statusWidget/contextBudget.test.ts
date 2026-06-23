import assert from "node:assert/strict";

import { describe, it } from "node:test";



import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";

import {

  billableStatusWidgetText,

  effectiveUserNoteBodyMax,

  effectiveUserNoteFocusMax,

  estimateStatusWidgetContextChars,

  estimateStatusWidgetContextCharsFromJson,

  resolveStatusWidgetReservedChars,

  STATUS_WIDGET_CONTEXT_MAX,

  validateStatusWidgetContextBudget,

} from "./contextBudget";

import { serializeStatusWidget } from "./serialize";



describe("statusWidget contextBudget", () => {

  it("counts label + instruction only — excludes htmlTemplate (Caveduck-style)", () => {

    const text = billableStatusWidgetText(DEFAULT_STATUS_WIDGET);

    assert.ok(!text.includes("<div"));

    assert.ok(!text.includes(DEFAULT_STATUS_WIDGET.htmlTemplate.slice(0, 24)));

    for (const field of DEFAULT_STATUS_WIDGET.fields) {

      assert.ok(text.includes(field.label));

      assert.ok(text.includes(field.instruction));

    }

    const heavyHtml = {

      ...DEFAULT_STATUS_WIDGET,

      htmlTemplate: "<div>" + "x".repeat(5000) + "</div>",

    };

    assert.equal(billableStatusWidgetText(heavyHtml), text);

    assert.equal(estimateStatusWidgetContextChars(heavyHtml), estimateStatusWidgetContextChars(DEFAULT_STATUS_WIDGET));

  });



  it("estimates token-equivalent chars with ceil(len × 0.9)", () => {

    const widget = {

      ...DEFAULT_STATUS_WIDGET,

      htmlTemplate: "ignored-html".repeat(100),

      fields: [{ id: "x", label: "라벨", instruction: "지시" }],

    };

    const chars = estimateStatusWidgetContextChars(widget);

    assert.equal(chars, Math.ceil(billableStatusWidgetText(widget).length * 0.9));

  });



  it("returns 0 for empty or invalid json", () => {

    assert.equal(estimateStatusWidgetContextCharsFromJson(null), 0);

    assert.equal(estimateStatusWidgetContextCharsFromJson("{}"), 0);

  });



  it("deducts character widget only in character_only mode", () => {

    const json = serializeStatusWidget(DEFAULT_STATUS_WIDGET);

    const characterOnly = resolveStatusWidgetReservedChars({

      characterWidgetJson: json,

      chatMode: "character_only",

    });

    const off = resolveStatusWidgetReservedChars({

      characterWidgetJson: json,

      chatMode: "off",

    });

    assert.ok(characterOnly > 0);

    assert.equal(off, 0);

  });



  it("stacks both widgets in both mode when field configs differ", () => {

    const json = serializeStatusWidget(DEFAULT_STATUS_WIDGET);

    const userJson = serializeStatusWidget({

      ...DEFAULT_STATUS_WIDGET,

      name: "내 위젯",

      htmlTemplate: "<p>{{time}}</p>",

      fields: [{ id: "mood", label: "기분", instruction: "캐릭터 기분을 한 단어로." }],

    });

    const both = resolveStatusWidgetReservedChars({

      characterWidgetJson: json,

      userWidgetJson: userJson,

      chatMode: "both",

    });

    const characterOnly = resolveStatusWidgetReservedChars({

      characterWidgetJson: json,

      userWidgetJson: userJson,

      chatMode: "character_only",

    });

    assert.ok(both > characterOnly);

  });



  it("focus and body max are independent of widget reserved chars", () => {
    assert.equal(effectiveUserNoteFocusMax(500), 1_000);
    assert.equal(effectiveUserNoteBodyMax(500), 10_000);
    assert.equal(effectiveUserNoteFocusMax(12_000), 1_000);
    assert.equal(effectiveUserNoteBodyMax(12_000), 10_000);
  });

  it("validates widget context budget separately from focus zone", () => {
    assert.equal(validateStatusWidgetContextBudget(135).ok, true);
    assert.equal(validateStatusWidgetContextBudget(STATUS_WIDGET_CONTEXT_MAX).ok, true);
    const over = validateStatusWidgetContextBudget(STATUS_WIDGET_CONTEXT_MAX + 1);
    assert.equal(over.ok, false);
    if (!over.ok) assert.match(over.error, /500/);
  });

});



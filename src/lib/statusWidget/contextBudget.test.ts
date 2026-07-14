import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import {
  effectiveUserNoteBodyMax,
  effectiveUserNoteFocusMax,
  estimateStatusWidgetContextChars,
  estimateStatusWidgetContextCharsFromJson,
  resolveStatusWidgetReservedBreakdown,
  resolveStatusWidgetReservedChars,
  STATUS_WIDGET_CONTEXT_MAX,
  validateStatusWidgetContextBudget,
} from "./contextBudget";
import { serializeStatusWidget } from "./serialize";

describe("statusWidget contextBudget", () => {
  it("estimates field label+instruction only (not HTML)", () => {
    const widget = {
      ...DEFAULT_STATUS_WIDGET,
      htmlTemplate: "<div>" + "x".repeat(5000) + "{{time}}</div>",
      fields: [{ id: "time", label: "시간", instruction: "현재 시각" }],
    };
    const chars = estimateStatusWidgetContextChars(widget);
    assert.ok(chars > 0);
    assert.ok(chars < 100);
  });

  it("returns 0 for empty/invalid json", () => {
    assert.equal(estimateStatusWidgetContextCharsFromJson(""), 0);
    assert.equal(estimateStatusWidgetContextCharsFromJson(null), 0);
    assert.equal(estimateStatusWidgetContextCharsFromJson("{}"), 0);
  });

  it("deducts character widget even when stored mode is off (creator always-on)", () => {
    const json = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
    const characterOnly = resolveStatusWidgetReservedChars({
      characterWidgetJson: json,
      chatMode: "character_only",
    });
    const off = resolveStatusWidgetReservedChars({
      characterWidgetJson: json,
      chatMode: "off",
      displayMode: "hidden",
    });
    assert.ok(characterOnly > 0);
    assert.equal(off, characterOnly);
  });

  it("no character widget and hidden display reserves zero", () => {
    assert.equal(
      resolveStatusWidgetReservedChars({
        chatMode: "off",
        displayMode: "hidden",
      }),
      0
    );
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
  });

  it("allows legacy combined numeric budget up to creator+user total", () => {
    assert.equal(validateStatusWidgetContextBudget(STATUS_WIDGET_CONTEXT_MAX * 2).ok, true);
    assert.equal(validateStatusWidgetContextBudget(STATUS_WIDGET_CONTEXT_MAX * 2 + 1).ok, false);
  });

  it("validates each widget against its own 500 char budget", () => {
    assert.equal(
      validateStatusWidgetContextBudget({
        characterReservedChars: STATUS_WIDGET_CONTEXT_MAX,
        userReservedChars: STATUS_WIDGET_CONTEXT_MAX,
        totalReservedChars: STATUS_WIDGET_CONTEXT_MAX * 2,
      }).ok,
      true
    );
    assert.equal(
      validateStatusWidgetContextBudget({
        characterReservedChars: STATUS_WIDGET_CONTEXT_MAX,
        userReservedChars: STATUS_WIDGET_CONTEXT_MAX + 1,
        totalReservedChars: STATUS_WIDGET_CONTEXT_MAX * 2 + 1,
      }).ok,
      false
    );
  });

  it("reports separate creator and user widget budget in both mode", () => {
    const json = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
    const userJson = serializeStatusWidget({
      ...DEFAULT_STATUS_WIDGET,
      name: "내 위젯",
      fields: [{ id: "mood", label: "기분", instruction: "캐릭터 기분을 한 단어로." }],
    });
    const breakdown = resolveStatusWidgetReservedBreakdown({
      characterWidgetJson: json,
      userWidgetJson: userJson,
      chatMode: "both",
    });
    assert.ok(breakdown.characterReservedChars > 0);
    assert.ok(breakdown.userReservedChars > 0);
    assert.equal(
      breakdown.totalReservedChars,
      breakdown.characterReservedChars + breakdown.userReservedChars
    );
  });
});

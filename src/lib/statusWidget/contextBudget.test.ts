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
  STATUS_WIDGET_USER_CONTEXT_MAX,
  STATUS_WIDGET_CONTEXT_COMBINED_MAX,
  validateCharacterStatusWidgetContextBudget,
  validateStatusWidgetContextBudget,
  formatWidgetBudgetHint,
  formatCombinedWidgetBudgetHint,
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

  it("reserves 0 when engine mode is off even if creator widget exists", () => {
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
    assert.equal(off, 0);
  });

  it("both + hidden still reserves creator + user context", () => {
    const json = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
    const userJson = serializeStatusWidget({
      ...DEFAULT_STATUS_WIDGET,
      name: "내 위젯",
      fields: [{ id: "mood", label: "기분", instruction: "캐릭터 기분을 한 단어로." }],
    });
    const hidden = resolveStatusWidgetReservedBreakdown({
      characterWidgetJson: json,
      userWidgetJson: userJson,
      chatMode: "both",
      displayMode: "hidden",
    });
    const shown = resolveStatusWidgetReservedBreakdown({
      characterWidgetJson: json,
      userWidgetJson: userJson,
      chatMode: "both",
      displayMode: "both",
    });
    assert.ok(hidden.characterReservedChars > 0);
    assert.ok(hidden.userReservedChars > 0);
    assert.equal(hidden.totalReservedChars, shown.totalReservedChars);
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
    assert.equal(validateStatusWidgetContextBudget(STATUS_WIDGET_CONTEXT_COMBINED_MAX).ok, true);
    assert.equal(validateStatusWidgetContextBudget(STATUS_WIDGET_CONTEXT_COMBINED_MAX + 1).ok, false);
  });

  it("enforces 700 for creators, unchanged 500 for persona and 1,200 combined", () => {
    assert.equal(STATUS_WIDGET_CONTEXT_MAX, 700);
    assert.equal(STATUS_WIDGET_USER_CONTEXT_MAX, 500);
    assert.equal(STATUS_WIDGET_CONTEXT_COMBINED_MAX, 1200);
    assert.equal(validateStatusWidgetContextBudget({
      characterReservedChars: 700,
      userReservedChars: 500,
      totalReservedChars: 1200,
    }).ok, true);
    assert.equal(validateStatusWidgetContextBudget({
      characterReservedChars: 701,
      userReservedChars: 0,
      totalReservedChars: 701,
    }).ok, false);
    assert.equal(validateStatusWidgetContextBudget({
      characterReservedChars: 0,
      userReservedChars: 501,
      totalReservedChars: 501,
    }).ok, false);
    assert.equal(formatWidgetBudgetHint(136), "위젯 상태값·지시 136 / 700자");
    assert.equal(formatWidgetBudgetHint(136, STATUS_WIDGET_USER_CONTEXT_MAX), "위젯 상태값·지시 136 / 500자");
    assert.match(formatCombinedWidgetBudgetHint({ characterReservedChars: 700, userReservedChars: 500, totalReservedChars: 1200 }), /700 \/ 700자 · 유저 500 \/ 500자/);
  });

  it("creator save budget is calculated from the same parsed widget used in chat", () => {
    const expanded = { ...DEFAULT_STATUS_WIDGET, fields: [{ id: "time", label: "시간", instruction: "장면".repeat(325) }] };
    const loaded = serializeStatusWidget(expanded);
    assert.equal(JSON.parse(loaded).fields[0].instruction.length, 650);
    assert.equal(estimateStatusWidgetContextCharsFromJson(loaded), estimateStatusWidgetContextChars(expanded));
    assert.equal(validateCharacterStatusWidgetContextBudget(expanded).ok, true);
    const overBudget = { ...expanded, fields: [
      expanded.fields[0],
      { id: "extra", label: "추가", instruction: "사건".repeat(150) },
    ] };
    assert.equal(validateCharacterStatusWidgetContextBudget(overBudget).ok, false);
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

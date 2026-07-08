import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareWidgetActiveDedupe,
  measureWidgetActiveOpenRouterInjection,
} from "./promptDedupeMetrics";
import { buildStatusWidgetPromptBlock } from "./prompt";
import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import { resolveStatusWidgetTurn } from "./resolve";

describe("promptDedupeMetrics", () => {
  it("keeps widget extraction dedupe structure stable", () => {
    const report = compareWidgetActiveDedupe();
    console.info("[status-widget-prompt-dedupe]", JSON.stringify(report, null, 2));

    assert.equal(report.after.deepSeekUserTurnExtraChars, 0);
    assert.equal(report.savedDeepSeekUserChars, 219);
    assert.ok(report.after.firewallChars < report.before.firewallChars);
    assert.ok(report.after.widgetBlockChars > 0);
    assert.ok(report.after.totalSystemInjectionChars > 0);
  });

  it("keeps JSON example only in widget block", () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: JSON.stringify(DEFAULT_STATUS_WIDGET),
      chatMode: "character_only",
    });
    const widget = buildStatusWidgetPromptBlock(resolved);
    const footprint = measureWidgetActiveOpenRouterInjection();

    assert.ok(widget.includes('"시간":"<scene value>"'));
    assert.ok(!footprint.firewallChars.toString().includes("<scene value>"));
    assert.doesNotMatch(widget, /<<<STATUS_VALUES>>>[\s\S]*<<<STATUS_VALUES>>>/);
  });

  it("default template widget block includes 의식의흐름 field and instruction", () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: JSON.stringify(DEFAULT_STATUS_WIDGET),
      chatMode: "character_only",
    });
    const widget = buildStatusWidgetPromptBlock(resolved);

    assert.match(widget, /의식의흐름/);
    assert.match(widget, /너무졸려서 바닥에 눕고싶다/);
    assert.match(widget, /데이트하자고 꼬셔야겠다/);
    assert.ok(widget.length >= 700);
  });
});

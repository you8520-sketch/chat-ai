import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareWidgetActiveDedupe,
  measureWidgetActiveOpenRouterInjection,
  PRE_DEDUPE_WIDGET_ACTIVE_FOOTPRINT,
} from "./promptDedupeMetrics";
import { buildStatusWidgetPromptBlock } from "./prompt";
import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import { resolveStatusWidgetTurn } from "./resolve";

describe("promptDedupeMetrics", () => {
  it("reports material reduction vs pre-dedupe snapshot", () => {
    const report = compareWidgetActiveDedupe();
    console.info("[status-widget-prompt-dedupe]", JSON.stringify(report, null, 2));

    assert.ok(report.savedSystemChars >= 300, `system chars saved: ${report.savedSystemChars}`);
    assert.equal(report.savedDeepSeekUserChars, 219);
    assert.ok(report.savedTotalCharsPerTurn >= 540);
    assert.ok(report.savedTotalPct >= 0.35);
    assert.equal(report.after.deepSeekUserTurnExtraChars, 0);
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

  it("widget block unchanged from pre-dedupe baseline", () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: JSON.stringify(DEFAULT_STATUS_WIDGET),
      chatMode: "character_only",
    });
    const widget = buildStatusWidgetPromptBlock(resolved);
    assert.equal(widget.length, PRE_DEDUPE_WIDGET_ACTIVE_FOOTPRINT.widgetBlockChars);
  });
});

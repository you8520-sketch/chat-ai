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
    assert.match(widget, /normal completed turn consumes some in-world time/);
    assert.ok(!footprint.firewallChars.toString().includes("<scene value>"));
    assert.doesNotMatch(widget, /<<<STATUS_VALUES>>>[\s\S]*<<<STATUS_VALUES>>>/);
  });

  it("default template widget block includes 현재목표 and 속마음 instructions", () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: JSON.stringify(DEFAULT_STATUS_WIDGET),
      chatMode: "character_only",
    });
    const widget = buildStatusWidgetPromptBlock(resolved);

    assert.match(widget, /현재목표/);
    assert.match(widget, /NPC가 지금 이루려는 단기 목표를 짧게 작성한다/);
    assert.match(widget, /NPC의 현재 내면을 자연스러운 1인칭 한 줄로 작성한다/);
    assert.doesNotMatch(widget, /의식의흐름/);
    assert.ok(widget.length >= 700);
  });
});

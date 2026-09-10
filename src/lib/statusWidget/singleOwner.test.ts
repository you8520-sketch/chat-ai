import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveStatusWindowPolicyFromSources } from "@/lib/statusWindowNotePolicy";
import { STATUS_WIDGET_STATE_POLICY_BLOCK } from "@/lib/stateWindowPolicy";
import { splitProseAndStatusWidgetValuesDeepSeek } from "./deepseekCapture";

describe("status-widget single canonical owner (Luna)", () => {
  it("widget-active prompt policy assigns extraction to Luna and forbids main-model status output", () => {
    const policy = resolveStatusWindowPolicyFromSources({ statusWidgetActive: true });
    assert.equal(policy.everyTurn, false);
    assert.equal(policy.policyBlock, STATUS_WIDGET_STATE_POLICY_BLOCK);
    assert.match(policy.policyBlock, /Do NOT embed status lines/);
    assert.match(policy.policyBlock, /<<<STATUS_VALUES>>> markers/);
    assert.match(policy.policyBlock, /GPT-5\.6 Luna.*extracts/);
    assert.doesNotMatch(policy.policyBlock, /required every turn/i);
    assert.doesNotMatch(policy.policyBlock, /append this block/i);
  });

  it("DeepSeek parse yields no values from leak-free prose (reader, not generator)", () => {
    const cleanProse = "태형이 문을 열었다. 들어와. 따뜻한 차를 내민다.";
    const split = splitProseAndStatusWidgetValuesDeepSeek(cleanProse);
    assert.equal(split.values.character ?? null, null);
    assert.equal(split.values.user ?? null, null);
    assert.equal(split.prose.trim(), cleanProse);
  });

  it("DeepSeek parse captures a leaked tail without any provider call (pure string op)", () => {
    const leaked =
      "본문 끝. <<<STATUS_VALUES char>>> {\"시간\":\"14:00\"} <<<END_STATUS>>>";
    const split = splitProseAndStatusWidgetValuesDeepSeek(leaked);
    assert.ok(split.values.character != null, "leaked tail must be captured as a compatibility read");
    assert.doesNotMatch(split.prose, /STATUS_VALUES/);
  });
});

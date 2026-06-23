import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOpenRouterOpusCompactTail } from "@/lib/corePrompt";
import type { OpenRouterSystemSplit } from "@/lib/openRouterCache";
import { STATE_WINDOW_POLICY_BLOCK } from "@/lib/stateWindowPolicy";
import {
  applyStatusWidgetSystemPromptOverrides,
  patchOpenRouterSplitForStatusWidget,
} from "@/lib/statusWidget/promptOverrides";
import { buildStatusWidgetAppendInstruction } from "@/lib/statusWidget/prompt";

describe("applyStatusWidgetSystemPromptOverrides", () => {
  it("replaces flash-owned forbid policy without appending duplicate tail reminders", () => {
    const base = `${STATE_WINDOW_POLICY_BLOCK}\n\n${buildOpenRouterOpusCompactTail()}`;
    const out = applyStatusWidgetSystemPromptOverrides(base);

    assert.doesNotMatch(out, /FLASH-OWNED/);
    assert.match(out, /CREATOR WIDGET/);
    assert.doesNotMatch(out, /FORBIDDEN\. NO html, json, markdown tables, or status UI/);
    assert.doesNotMatch(out, /\[FINAL — mandatory every reply\]/);
    assert.doesNotMatch(out, /Omitting the block is an error/);
  });
});

describe("patchOpenRouterSplitForStatusWidget", () => {
  it("patches prose guard only — widget lives in contextBuilder after length control", () => {
    const split: OpenRouterSystemSplit = {
      systemRulesBlock: "rules",
      characterSettingsBlock: "character",
      dynamicBlock: `${buildOpenRouterOpusCompactTail()}\n\n${buildStatusWidgetAppendInstruction()}`,
    };
    const out = patchOpenRouterSplitForStatusWidget(split);

    assert.match(out.dynamicBlock, /\[STATUS WIDGET — append after RP prose\]/);
    assert.doesNotMatch(out.dynamicBlock, /\[LENGTH CONTROL & SCENE EXPANSION\]/);
    assert.doesNotMatch(out.dynamicBlock, /\[FINAL — mandatory every reply\]/);
    assert.doesNotMatch(out.dynamicBlock, /FORBIDDEN\. NO html, json, markdown tables, or status UI/);
    assert.equal(out.characterSettingsBlock, "character");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  SELECTED_AI_OPTIONS,
  USER_SELECTABLE_AI_OPTIONS,
  isUserSelectableAI,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
} from "@/lib/chatModels";

describe("Terra retirement — never selectable, historical label preserved", () => {
  it("Terra is not in the picker and not user-selectable (even for admins)", () => {
    assert.equal(
      USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === CHEAPER_INFERENCE_GPT_56_TERRA_MODEL),
      false
    );
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL, false), false);
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL, true), false);
  });

  it("Terra is not a Main RP registry row or valid selection", () => {
    assert.ok(!SELECTED_AI_OPTIONS.some((o) => o.id === CHEAPER_INFERENCE_GPT_56_TERRA_MODEL));
    assert.equal(isValidSelectedAI(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), false);
    // Display label retained for historical receipts.
    assert.equal(selectedAILabel(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), "GPT-5.6 Terra");
  });

  it("stored Terra selections resolve to the default Main RP model", () => {
    assert.equal(
      resolveSelectedAI(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL),
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
    assert.equal(resolveSelectedAI("gpt-5.6-terra"), CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
  });
});
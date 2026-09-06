import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  SELECTED_AI_OPTIONS,
  USER_SELECTABLE_AI_OPTIONS,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
} from "@/lib/chatModels";

describe("Luna retirement from Main RP (auxiliary/background only)", () => {
  it("Luna is not in the picker and not a Main RP registry row", () => {
    assert.equal(
      USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === CHEAPER_INFERENCE_GPT_56_LUNA_MODEL),
      false
    );
    assert.ok(!SELECTED_AI_OPTIONS.some((o) => o.id === CHEAPER_INFERENCE_GPT_56_LUNA_MODEL));
    assert.equal(isValidSelectedAI(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL), false);
  });

  it("stored Luna selections resolve to the default Main RP model", () => {
    assert.equal(
      resolveSelectedAI(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL),
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
    assert.equal(
      resolveSelectedAI("gpt-5.6-luna"),
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
  });

  it("Luna display label is retained for historical receipts", () => {
    assert.equal(selectedAILabel(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL), "GPT-5.6 Luna");
  });
});
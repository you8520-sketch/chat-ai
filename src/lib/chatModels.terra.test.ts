import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  USER_SELECTABLE_AI_OPTIONS,
  isCheaperInferenceModel,
  isGpt56TerraModel,
  isUserSelectableAI,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
} from "@/lib/chatModels";

describe("GPT-5.6 Terra historical compatibility", () => {
  it("stays readable for receipts but is no longer a Main RP picker id", () => {
    assert.equal(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL, "gpt-5.6-terra");
    assert.equal(isValidSelectedAI(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), false);
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL, false), false);
    assert.equal(
      USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === CHEAPER_INFERENCE_GPT_56_TERRA_MODEL),
      false
    );
    assert.equal(isGpt56TerraModel(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), true);
    assert.equal(isCheaperInferenceModel(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), true);
    assert.equal(selectedAILabel(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), "GPT-5.6 Terra");
    assert.equal(
      resolveSelectedAI(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL),
      CHEAPER_INFERENCE_GPT_61_SOL_MODEL
    );
  });
});

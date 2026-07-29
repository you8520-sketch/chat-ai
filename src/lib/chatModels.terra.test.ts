import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  isCheaperInferenceModel,
  isGpt56TerraModel,
  isOpenRouterSelectedAI,
  isValidSelectedAI,
  selectedAILabel,
  selectedAIProvider,
} from "@/lib/chatModels";

describe("GPT-5.6 Terra model selection", () => {
  it("is selectable through CheaperInference, not OpenRouter", () => {
    assert.equal(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL, "gpt-5.6-terra");
    assert.equal(isValidSelectedAI(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), true);
    assert.equal(isGpt56TerraModel(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), true);
    assert.equal(
      selectedAIProvider(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL),
      "cheaperinference"
    );
    assert.equal(
      isCheaperInferenceModel(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL),
      true
    );
    assert.equal(isOpenRouterSelectedAI(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), false);
    assert.equal(
      selectedAILabel(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL),
      "GPT-5.6 Terra"
    );
  });
});

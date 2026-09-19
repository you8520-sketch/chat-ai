import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  USER_SELECTABLE_AI_OPTIONS,
  isCheaperInferenceModel,
  isGpt56TerraModel,
  isOpenRouterSelectedAI,
  isUserSelectableAI,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
  selectedAIProvider,
} from "@/lib/chatModels";

describe("GPT-5.6 Terra Main RP selection", () => {
  it("is a canonical CheaperInference Main RP model", () => {
    assert.equal(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL, "gpt-5.6-terra");
    assert.equal(isValidSelectedAI(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), true);
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL, false), true);
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL, true), true);
    assert.equal(
      USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === CHEAPER_INFERENCE_GPT_56_TERRA_MODEL),
      true
    );
    assert.equal(resolveSelectedAI(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), CHEAPER_INFERENCE_GPT_56_TERRA_MODEL);
    assert.equal(isGpt56TerraModel(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), true);
    assert.equal(isCheaperInferenceModel(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), true);
    assert.equal(selectedAIProvider(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), "cheaperinference");
    assert.equal(isOpenRouterSelectedAI(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), false);
    assert.equal(selectedAILabel(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), "GPT-5.6 Terra");
  });

  it("exposes Thinking OFF in the picker hint", () => {
    const option = USER_SELECTABLE_AI_OPTIONS.find(
      (o) => o.id === CHEAPER_INFERENCE_GPT_56_TERRA_MODEL
    );
    assert.ok(option);
    assert.match(option.hint, /Thinking OFF/);
  });
});

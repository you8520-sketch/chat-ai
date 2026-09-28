import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  CHEAPER_INFERENCE_GPT_6_SOL_MODEL,
  USER_SELECTABLE_AI_OPTIONS,
  isCheaperInferenceModel,
  isGpt6SolModel,
  isOpenRouterSelectedAI,
  isUserSelectableAI,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
  selectedAIProvider,
} from "@/lib/chatModels";

describe("GPT-6 Sol Main RP selection", () => {
  it("is the canonical CheaperInference premium Main RP model and retires Terra", () => {
    assert.equal(CHEAPER_INFERENCE_GPT_6_SOL_MODEL, "gpt-6-sol");
    assert.equal(isValidSelectedAI(CHEAPER_INFERENCE_GPT_6_SOL_MODEL), true);
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_GPT_6_SOL_MODEL, false), true);
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_GPT_6_SOL_MODEL, true), true);
    assert.equal(
      USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === CHEAPER_INFERENCE_GPT_6_SOL_MODEL),
      true
    );
    assert.equal(
      USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === CHEAPER_INFERENCE_GPT_56_TERRA_MODEL),
      false
    );
    assert.equal(resolveSelectedAI(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), CHEAPER_INFERENCE_GPT_6_SOL_MODEL);
    assert.equal(isGpt6SolModel(CHEAPER_INFERENCE_GPT_6_SOL_MODEL), true);
    assert.equal(isCheaperInferenceModel(CHEAPER_INFERENCE_GPT_6_SOL_MODEL), true);
    assert.equal(selectedAIProvider(CHEAPER_INFERENCE_GPT_6_SOL_MODEL), "cheaperinference");
    assert.equal(isOpenRouterSelectedAI(CHEAPER_INFERENCE_GPT_6_SOL_MODEL), false);
    assert.equal(selectedAILabel(CHEAPER_INFERENCE_GPT_6_SOL_MODEL), "GPT-6 Sol");
  });

  it("exposes Thinking OFF in the picker hint", () => {
    const option = USER_SELECTABLE_AI_OPTIONS.find(
      (o) => o.id === CHEAPER_INFERENCE_GPT_6_SOL_MODEL
    );
    assert.ok(option);
    assert.match(option.hint, /Thinking OFF/);
  });
});

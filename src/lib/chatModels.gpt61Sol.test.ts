import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  USER_SELECTABLE_AI_OPTIONS,
  isCheaperInferenceModel,
  isGpt56TerraModel,
  isGpt61SolModel,
  isOpenRouterSelectedAI,
  isUserSelectableAI,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
  selectedAIProvider,
} from "@/lib/chatModels";

describe("GPT-6.1 Sol Main RP selection", () => {
  it("is a canonical CheaperInference Main RP model", () => {
    assert.equal(CHEAPER_INFERENCE_GPT_61_SOL_MODEL, "gpt-6.1-sol");
    assert.equal(isValidSelectedAI(CHEAPER_INFERENCE_GPT_61_SOL_MODEL), true);
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_GPT_61_SOL_MODEL, false), true);
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_GPT_61_SOL_MODEL, true), true);
    assert.equal(
      USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === CHEAPER_INFERENCE_GPT_61_SOL_MODEL),
      true
    );
    assert.equal(
      resolveSelectedAI(CHEAPER_INFERENCE_GPT_61_SOL_MODEL),
      CHEAPER_INFERENCE_GPT_61_SOL_MODEL
    );
    assert.equal(isGpt61SolModel(CHEAPER_INFERENCE_GPT_61_SOL_MODEL), true);
    assert.equal(isCheaperInferenceModel(CHEAPER_INFERENCE_GPT_61_SOL_MODEL), true);
    assert.equal(selectedAIProvider(CHEAPER_INFERENCE_GPT_61_SOL_MODEL), "cheaperinference");
    assert.equal(isOpenRouterSelectedAI(CHEAPER_INFERENCE_GPT_61_SOL_MODEL), false);
    assert.equal(selectedAILabel(CHEAPER_INFERENCE_GPT_61_SOL_MODEL), "GPT-6.1 Sol");
  });

  it("exposes Reasoning low in the picker hint and does not copy Thinking OFF", () => {
    const option = USER_SELECTABLE_AI_OPTIONS.find(
      (o) => o.id === CHEAPER_INFERENCE_GPT_61_SOL_MODEL
    );
    assert.ok(option);
    assert.match(option.hint, /Reasoning low/);
    assert.equal(/Thinking OFF/.test(option.hint), false);
  });

  it("maps stored Terra selections to Sol while preserving Terra receipt labels", () => {
    assert.equal(isValidSelectedAI(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), false);
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL, false), false);
    assert.equal(
      resolveSelectedAI(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL),
      CHEAPER_INFERENCE_GPT_61_SOL_MODEL
    );
    assert.equal(isGpt56TerraModel(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), true);
    assert.equal(isGpt61SolModel(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), false);
    assert.equal(selectedAILabel(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), "GPT-5.6 Terra");
    assert.equal(selectedAILabel(CHEAPER_INFERENCE_GPT_61_SOL_MODEL), "GPT-6.1 Sol");
  });
});

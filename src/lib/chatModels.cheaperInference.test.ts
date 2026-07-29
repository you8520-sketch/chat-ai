import assert from "node:assert/strict";
import test from "node:test";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  USER_SELECTABLE_AI_OPTIONS,
  isAnthropicModel,
  isCheaperInferenceModel,
  resolveSelectedAI,
  selectedAILabel,
  selectedAIProvider,
} from "./chatModels";

test("Claude Opus 5 is a selectable Cheaper Inference model", () => {
  assert.equal(
    USER_SELECTABLE_AI_OPTIONS.some(
      (option) => option.id === CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL
    ),
    true
  );
  assert.equal(
    selectedAIProvider(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL),
    "cheaperinference"
  );
  assert.equal(selectedAILabel(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL), "Claude Opus 5");
  assert.equal(
    resolveSelectedAI(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL),
    CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL
  );
  assert.equal(isAnthropicModel(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL), true);
  assert.equal(isCheaperInferenceModel(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL), true);
  assert.equal(
    isCheaperInferenceModel(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL),
    true
  );
});

test("GPT-5.6 Luna is a selectable Cheaper Inference model", () => {
  assert.equal(
    USER_SELECTABLE_AI_OPTIONS.some(
      (option) => option.id === CHEAPER_INFERENCE_GPT_56_LUNA_MODEL
    ),
    true
  );
  assert.equal(
    selectedAIProvider(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL),
    "cheaperinference"
  );
  assert.equal(selectedAILabel(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL), "GPT-5.6 Luna");
  assert.equal(isCheaperInferenceModel(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL), true);
});

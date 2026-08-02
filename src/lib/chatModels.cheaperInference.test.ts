import assert from "node:assert/strict";
import test from "node:test";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
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

test("GPT-5.6 Luna stays Cheaper Inference but is temporarily hidden from picker", () => {
  assert.equal(
    USER_SELECTABLE_AI_OPTIONS.some(
      (option) => option.id === CHEAPER_INFERENCE_GPT_56_LUNA_MODEL
    ),
    false
  );
  assert.equal(
    selectedAIProvider(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL),
    "cheaperinference"
  );
  assert.equal(selectedAILabel(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL), "GPT-5.6 Luna");
  assert.equal(isCheaperInferenceModel(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL), true);
  assert.equal(
    resolveSelectedAI(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL),
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
  );
});

test("GPT-5.6 Terra is a selectable Cheaper Inference model", () => {
  assert.equal(
    USER_SELECTABLE_AI_OPTIONS.some(
      (option) => option.id === CHEAPER_INFERENCE_GPT_56_TERRA_MODEL
    ),
    true
  );
  assert.equal(
    selectedAIProvider(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL),
    "cheaperinference"
  );
  assert.equal(selectedAILabel(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), "GPT-5.6 Terra");
  assert.equal(isCheaperInferenceModel(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), true);
});

test("Gemini 3.1 Pro Preview is a selectable Cheaper Inference model", () => {
  assert.equal(
    USER_SELECTABLE_AI_OPTIONS.some(
      (option) => option.id === CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL
    ),
    true
  );
  assert.equal(
    selectedAIProvider(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL),
    "cheaperinference"
  );
  assert.equal(
    selectedAILabel(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL),
    "Gemini 3.1 Pro Preview"
  );
  assert.equal(
    isCheaperInferenceModel(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL),
    true
  );
});

test("DeepSeek V4 Pro migrates to the selectable Cheaper Inference model", () => {
  assert.equal(
    USER_SELECTABLE_AI_OPTIONS.some(
      (option) => option.id === CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    ),
    true
  );
  assert.equal(
    selectedAIProvider(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
    "cheaperinference"
  );
  assert.equal(
    resolveSelectedAI("deepseek/deepseek-v4-pro"),
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
  );
  assert.equal(
    isCheaperInferenceModel(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
    true
  );
});

test("DeepSeek V4 Flash is a selectable Cheaper Inference chat model", () => {
  assert.equal(
    USER_SELECTABLE_AI_OPTIONS.some(
      (option) => option.id === CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
    ),
    true
  );
  assert.equal(
    selectedAIProvider(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL),
    "cheaperinference"
  );
  assert.equal(
    selectedAILabel(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL),
    "DeepSeek V4 Flash"
  );
  assert.equal(
    resolveSelectedAI(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL),
    CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
  );
  assert.equal(
    isCheaperInferenceModel(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL),
    true
  );
});

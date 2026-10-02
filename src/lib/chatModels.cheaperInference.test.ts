import assert from "node:assert/strict";
import test from "node:test";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  CHEAPER_INFERENCE_GPT_6_LUNA_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  SELECTED_AI_OPTIONS,
  USER_SELECTABLE_AI_OPTIONS,
  isAnthropicModel,
  isCheaperInferenceGemini37FlashModel,
  isCheaperInferenceModel,
  resolveSelectedAI,
  selectedAILabel,
  selectedAIProvider,
} from "./chatModels";

test("Claude Opus 5 stays Cheaper Inference but is retired from Main RP picker", () => {
  assert.equal(
    USER_SELECTABLE_AI_OPTIONS.some(
      (option) => option.id === CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL
    ),
    false
  );
  assert.equal(
    SELECTED_AI_OPTIONS.some(
      (option) => option.id === CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL
    ),
    false
  );
  assert.equal(
    selectedAIProvider(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL),
    "cheaperinference"
  );
  assert.equal(selectedAILabel(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL), "Claude Opus 5");
  assert.equal(
    resolveSelectedAI(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL),
    CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL
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
    CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL
  );
});

test("GPT-6 Luna is the current hidden Cheaper Inference background model", () => {
  assert.equal(
    USER_SELECTABLE_AI_OPTIONS.some(
      (option) => option.id === CHEAPER_INFERENCE_GPT_6_LUNA_MODEL
    ),
    false
  );
  assert.equal(
    selectedAIProvider(CHEAPER_INFERENCE_GPT_6_LUNA_MODEL),
    "cheaperinference"
  );
  assert.equal(selectedAILabel(CHEAPER_INFERENCE_GPT_6_LUNA_MODEL), "GPT-6 Luna");
  assert.equal(isCheaperInferenceModel(CHEAPER_INFERENCE_GPT_6_LUNA_MODEL), true);
  assert.equal(
    resolveSelectedAI(CHEAPER_INFERENCE_GPT_6_LUNA_MODEL),
    CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL
  );
});

test("GPT-6.1 Sol is a selectable Cheaper Inference model and Terra remaps to it", () => {
  assert.equal(
    USER_SELECTABLE_AI_OPTIONS.some(
      (option) => option.id === CHEAPER_INFERENCE_GPT_61_SOL_MODEL
    ),
    true
  );
  assert.equal(
    USER_SELECTABLE_AI_OPTIONS.some(
      (option) => option.id === CHEAPER_INFERENCE_GPT_56_TERRA_MODEL
    ),
    false
  );
  assert.equal(
    selectedAIProvider(CHEAPER_INFERENCE_GPT_61_SOL_MODEL),
    "cheaperinference"
  );
  assert.equal(selectedAILabel(CHEAPER_INFERENCE_GPT_61_SOL_MODEL), "GPT-6.1 Sol");
  assert.equal(selectedAILabel(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), "GPT-5.6 Terra");
  assert.equal(isCheaperInferenceModel(CHEAPER_INFERENCE_GPT_61_SOL_MODEL), true);
  assert.equal(
    resolveSelectedAI(CHEAPER_INFERENCE_GPT_61_SOL_MODEL),
    CHEAPER_INFERENCE_GPT_61_SOL_MODEL
  );
  assert.equal(
    resolveSelectedAI(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL),
    CHEAPER_INFERENCE_GPT_61_SOL_MODEL
  );
});

test("Gemini 3.1 Pro Preview keeps its historical CI id but routes through OpenRouter", () => {
  assert.equal(
    USER_SELECTABLE_AI_OPTIONS.some(
      (option) => option.id === CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL
    ),
    true
  );
  assert.equal(
    selectedAIProvider(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL),
    "openrouter"
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

test("Gemini 3.7 Flash keeps its historical CI id but routes through OpenRouter", () => {
  assert.equal(
    USER_SELECTABLE_AI_OPTIONS.some(
      (option) => option.id === CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL
    ),
    true
  );
  assert.equal(
    selectedAIProvider(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL),
    "openrouter"
  );
  assert.equal(
    selectedAILabel(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL),
    "Gemini 3.7 Flash"
  );
  assert.equal(
    isCheaperInferenceModel(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL),
    true
  );
  assert.equal(
    isCheaperInferenceGemini37FlashModel(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL),
    true
  );
  assert.equal(
    isCheaperInferenceGemini37FlashModel(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL),
    false
  );
  assert.equal(
    resolveSelectedAI(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL),
    CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL
  );
  assert.equal(
    resolveSelectedAI("google/gemini-3.7-flash"),
    CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL
  );
});

test("DeepSeek V4 Pro is retired from Main RP and migrates to V4.1 Flash", () => {
  assert.equal(
    USER_SELECTABLE_AI_OPTIONS.some(
      (option) => option.id === CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    ),
    false
  );
  assert.equal(
    selectedAIProvider(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL),
    "cheaperinference"
  );
  assert.equal(selectedAILabel(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL), "DeepSeek V4 Pro");
  assert.equal(
    resolveSelectedAI("deepseek/deepseek-v4-pro"),
    CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL
  );
  assert.equal(
    resolveSelectedAI(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
    CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL
  );
  assert.equal(
    isCheaperInferenceModel(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
    true
  );
});

test("DeepSeek V4 Flash is retired from Main RP but stays Cheaper Inference auxiliary", () => {
  assert.equal(
    USER_SELECTABLE_AI_OPTIONS.some(
      (option) => option.id === CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
    ),
    false
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
    CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL
  );
  assert.equal(
    isCheaperInferenceModel(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL),
    true
  );
});

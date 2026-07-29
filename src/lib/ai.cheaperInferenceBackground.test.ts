import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKGROUND_OPENROUTER_MODEL,
  resolveBackgroundMemoryFallbackModel,
  resolveBackgroundTextModelId,
} from "./ai";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  OPENROUTER_DEEPSEEK_V3_MODEL,
} from "./chatModels";

test("background text defaults to Cheaper Inference DeepSeek V4 Flash", () => {
  assert.equal(
    resolveBackgroundTextModelId(undefined),
    CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
  );
  assert.equal(
    resolveBackgroundTextModelId(OPENROUTER_DEEPSEEK_V3_MODEL),
    CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
  );
  assert.equal(
    BACKGROUND_OPENROUTER_MODEL,
    CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
  );
});

test("legacy V3 fallback does not cause a second call to the same V4 model", () => {
  assert.equal(
    resolveBackgroundMemoryFallbackModel(
      { BACKGROUND_MEMORY_FALLBACK_MODEL: OPENROUTER_DEEPSEEK_V3_MODEL },
      CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
    ),
    null
  );
  assert.equal(
    resolveBackgroundMemoryFallbackModel(
      { BACKGROUND_MEMORY_FALLBACK_MODEL: "   " },
      "custom-model"
    ),
    null
  );
});

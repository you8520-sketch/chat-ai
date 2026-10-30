import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADULT_REFUSAL_FALLBACK_MODEL_ID,
  isAdultRefusalHandoffCase,
  isAllowedAdultHandoffTargetModel,
  resolveAdultHandoffTargetModelId,
  resolveAdultRefusalFallbackModelId,
} from "./adultHandoffSourceRouting";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_1017_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
} from "./chatModels";

describe("adult refusal fallback routing", () => {
  it("uses DeepSeek 1017 as the only adult handoff target", () => {
    assert.equal(ADULT_REFUSAL_FALLBACK_MODEL_ID, "deepseek-v4.1-flash-1017");
    assert.equal(
      resolveAdultRefusalFallbackModelId(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL),
      "deepseek-v4.1-flash-1017"
    );
    assert.equal(
      resolveAdultHandoffTargetModelId({
        sourceModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        existingAdultModelId: "legacy-model",
      }),
      "deepseek-v4.1-flash-1017"
    );
    assert.equal(
      resolveAdultHandoffTargetModelId({
        sourceModelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
        existingAdultModelId: "legacy-model",
      }),
      "deepseek-v4.1-flash-1017"
    );
  });

  it("allows only DeepSeek 1017 as handoff target", () => {
    assert.equal(isAllowedAdultHandoffTargetModel("deepseek-v4.1-flash-1017"), true);
    assert.equal(isAllowedAdultHandoffTargetModel("deepseek-v4.1-flash"), false);
    assert.equal(isAllowedAdultHandoffTargetModel("deepseek-v4-pro-0813"), false);
    assert.equal(isAllowedAdultHandoffTargetModel("qwen-3-8-max"), false);
    assert.equal(
      isAllowedAdultHandoffTargetModel(CHEAPER_INFERENCE_QWEN_38_MAX_MODEL),
      false
    );
  });

  it("does not treat native 1017 selection as a handoff case", () => {
    assert.equal(
      isAdultRefusalHandoffCase(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_1017_MODEL),
      false
    );
    assert.equal(
      isAdultRefusalHandoffCase(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL),
      true
    );
    assert.equal(
      isAdultRefusalHandoffCase(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
      true
    );
    assert.equal(
      isAdultRefusalHandoffCase(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL),
      true
    );
    assert.equal(
      isAdultRefusalHandoffCase(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL),
      true
    );
  });
});

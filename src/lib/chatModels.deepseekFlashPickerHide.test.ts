import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  SELECTED_AI_OPTIONS,
  USER_SELECTABLE_AI_OPTIONS,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
} from "@/lib/chatModels";

describe("DeepSeek V4 Flash picker hide + legacy normalize", () => {
  it("public picker contains deepseek-v4-flash = false", () => {
    assert.equal(
      USER_SELECTABLE_AI_OPTIONS.some(
        (o) => o.id === CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
      ),
      false
    );
  });

  it("registry keeps flash for receipts / background / decoding", () => {
    assert.ok(
      SELECTED_AI_OPTIONS.some(
        (o) => o.id === CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
      )
    );
    assert.equal(isValidSelectedAI(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL), true);
    assert.equal(
      selectedAILabel(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL),
      "DeepSeek V4 Flash"
    );
  });

  it("legacy saved flash resolves to deepseek-v4-pro", () => {
    assert.equal(
      resolveSelectedAI(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL),
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
    assert.equal(
      resolveSelectedAI("deepseek-v4-flash"),
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
  });
});

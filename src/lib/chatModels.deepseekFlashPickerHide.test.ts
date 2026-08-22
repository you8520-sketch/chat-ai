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
    assert.equal(
      USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === "deepseek-v4-flash"),
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
    assert.equal(isValidSelectedAI("deepseek-v4-flash"), true);
    assert.equal(
      selectedAILabel(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL),
      "DeepSeek V4 Flash"
    );
    assert.equal(selectedAILabel("deepseek-v4-flash"), "DeepSeek V4 Flash");
  });

  it("legacy saved flash stays a valid Flash selection and resolves to 0731", () => {
    assert.equal(
      resolveSelectedAI(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL),
      "deepseek-v4-flash-0731"
    );
    assert.equal(
      resolveSelectedAI("deepseek-v4-flash"),
      "deepseek-v4-flash-0731"
    );
    assert.notEqual(
      resolveSelectedAI("deepseek-v4-flash"),
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
  });
});

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

describe("DeepSeek V4 Flash retirement from Main RP", () => {
  it("Flash is not in the picker and not a Main RP registry row", () => {
    assert.equal(
      USER_SELECTABLE_AI_OPTIONS.some(
        (o) => o.id === CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
      ),
      false
    );
    assert.ok(
      !SELECTED_AI_OPTIONS.some(
        (o) => o.id === CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
      )
    );
    assert.equal(isValidSelectedAI(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL), false);
    assert.equal(isValidSelectedAI("deepseek-v4-flash"), false);
  });

  it("stored Flash selections resolve to the default Main RP model", () => {
    assert.equal(
      resolveSelectedAI(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL),
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
    assert.equal(
      resolveSelectedAI("deepseek-v4-flash"),
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
  });

  it("Flash display label is retained for historical receipts", () => {
    assert.equal(
      selectedAILabel(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL),
      "DeepSeek V4 Flash"
    );
    assert.equal(selectedAILabel("deepseek-v4-flash"), "DeepSeek V4 Flash");
  });
});
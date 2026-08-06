import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  SELECTED_AI_OPTIONS,
  USER_SELECTABLE_AI_OPTIONS,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
} from "@/lib/chatModels";

describe("Luna public picker removal + legacy normalize", () => {
  it("public picker contains luna = false", () => {
    assert.equal(
      USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === CHEAPER_INFERENCE_GPT_56_LUNA_MODEL),
      false
    );
  });

  it("registry keeps luna for receipts / decoding", () => {
    assert.ok(SELECTED_AI_OPTIONS.some((o) => o.id === CHEAPER_INFERENCE_GPT_56_LUNA_MODEL));
    assert.equal(isValidSelectedAI(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL), true);
    assert.equal(selectedAILabel(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL), "GPT-5.6 Luna");
  });

  it("legacy saved luna resolves to deepseek-v4-pro", () => {
    assert.equal(
      resolveSelectedAI(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL),
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
  });

  it("new preference cannot keep luna after resolve", () => {
    // PATCH allow-list uses USER_SELECTABLE; resolve also coerces away.
    assert.equal(
      resolveSelectedAI("gpt-5.6-luna"),
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
  });
});

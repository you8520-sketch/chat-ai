import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "@/lib/chatModels";
import {
  GEMINI37_FLASH_LENGTH_SENTENCE,
  resolveGemini37FlashLengthAdapterSection,
} from "@/lib/gemini37FlashLengthAdapter";

describe("gemini37FlashLengthAdapter", () => {
  it("returns the single length sentence for Gemini 3.7 Flash only", () => {
    assert.equal(
      resolveGemini37FlashLengthAdapterSection(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL),
      GEMINI37_FLASH_LENGTH_SENTENCE
    );
  });

  it("does not inject for Gemini 3.1 or other models", () => {
    assert.equal(
      resolveGemini37FlashLengthAdapterSection(
        CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL
      ),
      null
    );
    assert.equal(resolveGemini37FlashLengthAdapterSection("anthropic/claude-opus-5"), null);
    assert.equal(resolveGemini37FlashLengthAdapterSection(""), null);
  });

  it("contains no extra style / agency / dialogue / world copy", () => {
    assert.equal(
      GEMINI37_FLASH_LENGTH_SENTENCE,
      "현재 장면을 충분히 전개하여 한국어 공백 포함 약 3,200~4,000자 분량으로 완성한다. 짧게 마무리하거나 요약하지 않는다."
    );
    assert.doesNotMatch(GEMINI37_FLASH_LENGTH_SENTENCE, /agency|서술\s*80|대사|world-motion|반복/i);
  });
});

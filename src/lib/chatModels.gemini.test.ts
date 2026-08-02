import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  DEFAULT_SELECTED_AI,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  SELECTED_AI_OPTIONS,
  USER_SELECTABLE_AI_OPTIONS,
  isCheaperInferenceGemini31ProModel,
  isCheaperInferenceModel,
  isGemini31ProModel,
  isGemini36FlashModel,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
  selectedAIProvider,
} from "@/lib/chatModels";
import {
  resolveOpenRouterModelId,
  resolveRpOpenRouterModelId,
} from "@/lib/openRouterConfig";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";

describe("Gemini picker visibility", () => {
  it("keeps Cheaper Inference Gemini 3.1 Pro Preview selectable", () => {
    assert.ok(
      USER_SELECTABLE_AI_OPTIONS.some(
        (o) => o.id === CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL
      )
    );
    assert.equal(
      selectedAIProvider(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL),
      "cheaperinference"
    );
    assert.equal(
      isCheaperInferenceModel(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL),
      true
    );
    assert.equal(
      isCheaperInferenceGemini31ProModel(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL),
      true
    );
    assert.equal(
      resolveSelectedAI(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL),
      CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL
    );
  });

  it("hides OpenRouter Gemini 3.6 Flash from user selection", () => {
    assert.ok(
      SELECTED_AI_OPTIONS.some((o) => o.id === OPENROUTER_GEMINI_36_FLASH_MODEL),
      "kept in SELECTED_AI_OPTIONS for receipt/legacy compatibility"
    );
    assert.ok(
      !USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === OPENROUTER_GEMINI_36_FLASH_MODEL)
    );
    assert.equal(resolveSelectedAI(OPENROUTER_GEMINI_36_FLASH_MODEL), DEFAULT_SELECTED_AI);
    assert.equal(resolveSelectedAI("google/gemini-3.6-flash"), DEFAULT_SELECTED_AI);
    assert.equal(resolveSelectedAI("gemini-3.6-flash"), DEFAULT_SELECTED_AI);
  });

  it("migrates removed Gemini 2.5 selections away from the hidden 3.6 Flash picker", () => {
    for (const legacy of [
      "gemini-2.5-pro",
      "google/gemini-2.5-pro",
      "gemini-2.5-flash",
    ]) {
      assert.equal(resolveSelectedAI(legacy), DEFAULT_SELECTED_AI);
    }
    // OpenRouter routing aliases can still target 3.6 for non-picker paths.
    assert.equal(
      resolveOpenRouterModelId(OPENROUTER_GEMINI_25_PRO_MODEL),
      OPENROUTER_GEMINI_36_FLASH_MODEL
    );
    assert.equal(
      resolveRpOpenRouterModelId("google/gemini-2.5-pro"),
      OPENROUTER_GEMINI_36_FLASH_MODEL
    );
  });
});

describe("Gemini rate compatibility", () => {
  it("keeps 3.6 list-price tier for historical receipts", () => {
    assert.ok(isGemini36FlashModel(OPENROUTER_GEMINI_36_FLASH_MODEL));
    const rates = resolveOpenRouterModelRates(OPENROUTER_GEMINI_36_FLASH_MODEL);
    assert.equal(rates.family, "google");
    assert.equal(rates.inputUsdPerM, 1.5);
    assert.equal(rates.outputUsdPerM, 7.5);
    assert.equal(rates.cacheReadUsdPerM, 0.15);
  });

  it("keeps OpenRouter 3.1 historical receipt metadata without making it selectable", () => {
    assert.equal(isValidSelectedAI(OPENROUTER_GEMINI_31_PRO_MODEL), false);
    assert.equal(resolveSelectedAI(OPENROUTER_GEMINI_31_PRO_MODEL), DEFAULT_SELECTED_AI);
    assert.ok(isGemini31ProModel(OPENROUTER_GEMINI_31_PRO_MODEL));
    const rates = resolveOpenRouterModelRates(OPENROUTER_GEMINI_31_PRO_MODEL);
    assert.equal(rates.inputUsdPerM, 2);
    assert.equal(rates.outputUsdPerM, 12);
    assert.equal(selectedAILabel(OPENROUTER_GEMINI_31_PRO_MODEL), "Gemini 3.1 Pro");
  });

  it("default remains DeepSeek V4 Pro", () => {
    assert.equal(DEFAULT_SELECTED_AI, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
  });
});

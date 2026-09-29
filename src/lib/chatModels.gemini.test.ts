import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  DEFAULT_SELECTED_AI,
  GEMINI_38_FLASH_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  OPENROUTER_GEMINI_37_FLASH_MODEL,
  OPENROUTER_GEMINI_38_FLASH_MODEL,
  SELECTED_AI_OPTIONS,
  USER_SELECTABLE_AI_OPTIONS,
  isCheaperInferenceGemini31ProModel,
  isCheaperInferenceGemini37FlashModel,
  isCheaperInferenceModel,
  isGemini31ProModel,
  isGeminiFlashOpenRouterModel,
  isGemini36FlashModel,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
  selectedAIProvider,
} from "@/lib/chatModels";
import {
  resolveMainRpOpenRouterRoutePolicy,
  resolveOpenRouterModelId,
  resolveRpOpenRouterModelId,
} from "@/lib/openRouterConfig";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";

describe("Gemini Main RP routing", () => {
  it("routes Gemini 3.1 through OpenRouter while preserving the provider-neutral stored id", () => {
    assert.ok(
      USER_SELECTABLE_AI_OPTIONS.some(
        (o) => o.id === CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL
      )
    );
    assert.equal(
      selectedAIProvider(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL),
      "openrouter"
    );
    // Historical-family helpers remain true for old receipts/compatibility; they are not route owners.
    assert.equal(
      isCheaperInferenceModel(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL),
      true
    );
    assert.equal(
      isCheaperInferenceGemini31ProModel(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL),
      true
    );
    assert.equal(
      resolveOpenRouterModelId(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL),
      OPENROUTER_GEMINI_31_PRO_MODEL
    );
  });

  it("routes Gemini 3.7 and 3.8 to their Google OpenRouter slugs", () => {
    assert.equal(
      selectedAIProvider(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL),
      "openrouter"
    );
    assert.equal(selectedAIProvider(GEMINI_38_FLASH_MODEL), "openrouter");
    assert.equal(
      resolveOpenRouterModelId(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL),
      OPENROUTER_GEMINI_37_FLASH_MODEL
    );
    assert.equal(
      resolveOpenRouterModelId(GEMINI_38_FLASH_MODEL),
      OPENROUTER_GEMINI_38_FLASH_MODEL
    );
    assert.equal(isGeminiFlashOpenRouterModel(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL), true);
    assert.equal(isGeminiFlashOpenRouterModel(GEMINI_38_FLASH_MODEL), true);
    assert.equal(
      isCheaperInferenceGemini37FlashModel(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL),
      true
    );
  });

  it("pins all active Gemini routes to Google AI Studio Flex with no provider fallback", () => {
    for (const modelId of [
      CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      GEMINI_38_FLASH_MODEL,
    ]) {
      assert.deepEqual(resolveMainRpOpenRouterRoutePolicy(modelId), {
        provider: {
          only: ["google-ai-studio"],
          allow_fallbacks: false,
          require_parameters: true,
        },
        serviceTier: "flex",
      });
    }
  });

  it("keeps Gemini 3.6 Flash retired from Main RP selection", () => {
    assert.ok(
      !SELECTED_AI_OPTIONS.some((o) => o.id === OPENROUTER_GEMINI_36_FLASH_MODEL)
    );
    assert.equal(resolveSelectedAI(OPENROUTER_GEMINI_36_FLASH_MODEL), DEFAULT_SELECTED_AI);
    assert.equal(resolveSelectedAI("google/gemini-3.6-flash"), DEFAULT_SELECTED_AI);
  });

  it("keeps removed Gemini 2.5 aliases away from the picker", () => {
    for (const legacy of [
      "gemini-2.5-pro",
      "google/gemini-2.5-pro",
      "gemini-2.5-flash",
    ]) {
      assert.equal(resolveSelectedAI(legacy), DEFAULT_SELECTED_AI);
    }
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

describe("Gemini route-rate compatibility", () => {
  it("keeps 3.6 historical rate metadata", () => {
    assert.ok(isGemini36FlashModel(OPENROUTER_GEMINI_36_FLASH_MODEL));
    const rates = resolveOpenRouterModelRates(OPENROUTER_GEMINI_36_FLASH_MODEL);
    assert.equal(rates.family, "google");
    assert.equal(rates.inputUsdPerM, 1.5);
    assert.equal(rates.outputUsdPerM, 7.5);
  });

  it("uses Flex fallback rates when routed Gemini cost telemetry is absent", () => {
    const g31 = resolveOpenRouterModelRates(OPENROUTER_GEMINI_31_PRO_MODEL);
    assert.equal(g31.inputUsdPerM, 1);
    assert.equal(g31.outputUsdPerM, 6);
    assert.equal(g31.cacheReadUsdPerM, 0.1);

    for (const slug of [OPENROUTER_GEMINI_37_FLASH_MODEL, OPENROUTER_GEMINI_38_FLASH_MODEL]) {
      const rates = resolveOpenRouterModelRates(slug);
      assert.equal(rates.inputUsdPerM, 0.75);
      assert.equal(rates.outputUsdPerM, 3.75);
      assert.equal(rates.cacheReadUsdPerM, 0.075);
    }
  });

  it("keeps OpenRouter 3.1 slug non-selectable as a stored id", () => {
    assert.equal(isValidSelectedAI(OPENROUTER_GEMINI_31_PRO_MODEL), false);
    assert.ok(isGemini31ProModel(OPENROUTER_GEMINI_31_PRO_MODEL));
    assert.equal(selectedAILabel(OPENROUTER_GEMINI_31_PRO_MODEL), "Gemini 3.1 Pro");
  });

  it("default remains DeepSeek V4.1 Flash", () => {
    assert.equal(DEFAULT_SELECTED_AI, CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
  });
});

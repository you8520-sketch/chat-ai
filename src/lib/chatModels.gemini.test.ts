import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SELECTED_AI,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  SELECTED_AI_OPTIONS,
  isGemini31ProModel,
  isGemini36FlashModel,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
} from "@/lib/chatModels";
import {
  resolveOpenRouterModelId,
  resolveRpOpenRouterModelId,
} from "@/lib/openRouterConfig";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";

describe("Gemini 3.6 Flash on OpenRouter", () => {
  it("is the only selectable Gemini option", () => {
    assert.ok(
      SELECTED_AI_OPTIONS.some(
        (o: { id: string }) => o.id === OPENROUTER_GEMINI_36_FLASH_MODEL
      )
    );
    assert.ok(isValidSelectedAI(OPENROUTER_GEMINI_36_FLASH_MODEL));
    assert.equal(isValidSelectedAI(OPENROUTER_GEMINI_25_PRO_MODEL), false);
    assert.equal(isValidSelectedAI(OPENROUTER_GEMINI_31_PRO_MODEL), false);
  });

  it("migrates removed Gemini 2.5 selections and routing to 3.6 Flash", () => {
    for (const legacy of [
      "gemini-2.5-pro",
      "google/gemini-2.5-pro",
      "gemini-2.5-flash",
    ]) {
      assert.equal(resolveSelectedAI(legacy), OPENROUTER_GEMINI_36_FLASH_MODEL);
      assert.equal(resolveRpOpenRouterModelId(legacy), OPENROUTER_GEMINI_36_FLASH_MODEL);
    }
    assert.equal(
      resolveOpenRouterModelId(OPENROUTER_GEMINI_25_PRO_MODEL),
      OPENROUTER_GEMINI_36_FLASH_MODEL
    );
  });

  it("uses the OpenRouter 3.6 list-price tier", () => {
    assert.ok(isGemini36FlashModel(OPENROUTER_GEMINI_36_FLASH_MODEL));
    const rates = resolveOpenRouterModelRates(OPENROUTER_GEMINI_36_FLASH_MODEL);
    assert.equal(rates.family, "google");
    assert.equal(rates.inputUsdPerM, 1.5);
    assert.equal(rates.outputUsdPerM, 7.5);
    assert.equal(rates.cacheReadUsdPerM, 0.15);
  });
});

describe("retired Gemini compatibility", () => {
  it("keeps 3.1 historical receipt metadata without making it selectable", () => {
    assert.equal(resolveSelectedAI(OPENROUTER_GEMINI_31_PRO_MODEL), DEFAULT_SELECTED_AI);
    assert.ok(isGemini31ProModel(OPENROUTER_GEMINI_31_PRO_MODEL));
    const rates = resolveOpenRouterModelRates(OPENROUTER_GEMINI_31_PRO_MODEL);
    assert.equal(rates.inputUsdPerM, 2);
    assert.equal(rates.outputUsdPerM, 12);
    assert.equal(selectedAILabel(OPENROUTER_GEMINI_31_PRO_MODEL), "Gemini 3.1 Pro");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SELECTED_AI,
  OPENROUTER_SOLAR_PRO_3_MODEL,
  SELECTED_AI_OPTIONS,
  isSolarPro3Model,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
} from "@/lib/chatModels";
import { resolveOpenRouterModelId } from "@/lib/openRouterConfig";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";

describe("Solar Pro 3 on OpenRouter", () => {
  it("is selectable without replacing the existing default", () => {
    assert.notEqual(DEFAULT_SELECTED_AI, OPENROUTER_SOLAR_PRO_3_MODEL);
    assert.ok(SELECTED_AI_OPTIONS.some((o) => o.id === OPENROUTER_SOLAR_PRO_3_MODEL));
    assert.ok(isValidSelectedAI(OPENROUTER_SOLAR_PRO_3_MODEL));
    assert.equal(selectedAILabel(OPENROUTER_SOLAR_PRO_3_MODEL), "Solar Pro 3");
    const solar = SELECTED_AI_OPTIONS.find((o) => o.id === OPENROUTER_SOLAR_PRO_3_MODEL);
    assert.equal(solar?.hint, "Upstage");
    assert.equal(solar?.recommended, undefined);
  });

  it("maps Solar aliases to the official OpenRouter slug", () => {
    assert.equal(resolveSelectedAI("solar"), OPENROUTER_SOLAR_PRO_3_MODEL);
    assert.equal(resolveSelectedAI("solar-pro"), OPENROUTER_SOLAR_PRO_3_MODEL);
    assert.equal(resolveSelectedAI("solar-pro-3"), OPENROUTER_SOLAR_PRO_3_MODEL);
    assert.equal(
      resolveOpenRouterModelId(OPENROUTER_SOLAR_PRO_3_MODEL),
      OPENROUTER_SOLAR_PRO_3_MODEL
    );
  });

  it("uses Upstage Solar Pro 3 list pricing", () => {
    assert.ok(isSolarPro3Model(OPENROUTER_SOLAR_PRO_3_MODEL));
    const rates = resolveOpenRouterModelRates(OPENROUTER_SOLAR_PRO_3_MODEL);
    assert.equal(rates.inputUsdPerM, 0.15);
    assert.equal(rates.outputUsdPerM, 0.6);
    assert.equal(rates.cacheReadUsdPerM, 0.015);
  });
});

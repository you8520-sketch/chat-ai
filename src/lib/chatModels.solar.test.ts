import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SELECTED_AI,
  OPENROUTER_SOLAR_PRO_3_MODEL,
  SELECTED_AI_OPTIONS,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
} from "@/lib/chatModels";
import { resolveOpenRouterModelId } from "@/lib/openRouterConfig";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";

describe("retired Solar Pro 3 compatibility", () => {
  it("is no longer selectable", () => {
    assert.notEqual(DEFAULT_SELECTED_AI, OPENROUTER_SOLAR_PRO_3_MODEL);
    assert.ok(!SELECTED_AI_OPTIONS.some((o) => o.id === OPENROUTER_SOLAR_PRO_3_MODEL));
    assert.equal(isValidSelectedAI(OPENROUTER_SOLAR_PRO_3_MODEL), false);
    assert.equal(selectedAILabel(OPENROUTER_SOLAR_PRO_3_MODEL), "Solar Pro 3");
  });

  it("migrates stored Solar selections to the default model", () => {
    assert.equal(resolveSelectedAI("solar"), DEFAULT_SELECTED_AI);
    assert.equal(resolveSelectedAI("solar-pro"), DEFAULT_SELECTED_AI);
    assert.equal(resolveSelectedAI("solar-pro-3"), DEFAULT_SELECTED_AI);
    assert.equal(resolveSelectedAI(OPENROUTER_SOLAR_PRO_3_MODEL), DEFAULT_SELECTED_AI);
    assert.equal(
      resolveOpenRouterModelId(OPENROUTER_SOLAR_PRO_3_MODEL),
      DEFAULT_SELECTED_AI
    );
  });

  it("keeps historical Solar receipts priced correctly", () => {
    const rates = resolveOpenRouterModelRates(OPENROUTER_SOLAR_PRO_3_MODEL);
    assert.equal(rates.inputUsdPerM, 0.15);
    assert.equal(rates.outputUsdPerM, 0.6);
    assert.equal(rates.cacheReadUsdPerM, 0.015);
  });
});

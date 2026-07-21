import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SELECTED_AI,
  OPENROUTER_KIMI_K3_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  SELECTED_AI_OPTIONS,
  isKimiModel,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
} from "@/lib/chatModels";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";

describe("Kimi K3 retired from selection", () => {
  it("is not a selectable UI option", () => {
    assert.ok(!SELECTED_AI_OPTIONS.some((o) => o.id === OPENROUTER_KIMI_K3_MODEL));
    assert.equal(isValidSelectedAI(OPENROUTER_KIMI_K3_MODEL), false);
  });

  it("maps legacy kimi slugs to Muse Spark 1.1", () => {
    assert.equal(DEFAULT_SELECTED_AI, OPENROUTER_MUSE_SPARK_11_MODEL);
    assert.equal(resolveSelectedAI("kimi"), OPENROUTER_MUSE_SPARK_11_MODEL);
    assert.equal(resolveSelectedAI("kimi-k3"), OPENROUTER_MUSE_SPARK_11_MODEL);
    assert.equal(resolveSelectedAI("moonshotai/kimi-latest"), OPENROUTER_MUSE_SPARK_11_MODEL);
    assert.equal(resolveSelectedAI(OPENROUTER_KIMI_K3_MODEL), OPENROUTER_MUSE_SPARK_11_MODEL);
  });

  it("keeps Kimi display name and pricing for residual receipts", () => {
    assert.ok(isKimiModel(OPENROUTER_KIMI_K3_MODEL));
    assert.equal(selectedAILabel(OPENROUTER_KIMI_K3_MODEL), "Kimi K3");
    const rates = resolveOpenRouterModelRates(OPENROUTER_KIMI_K3_MODEL);
    assert.equal(rates.inputUsdPerM, 3);
    assert.equal(rates.outputUsdPerM, 15);
    assert.equal(rates.cacheReadUsdPerM, 0.3);
  });
});

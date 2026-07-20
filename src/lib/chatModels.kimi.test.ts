import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_KIMI_K3_MODEL,
  SELECTED_AI_OPTIONS,
  isKimiModel,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
} from "@/lib/chatModels";
import { resolveOpenRouterModelId } from "@/lib/openRouterConfig";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";

describe("Kimi K3 on OpenRouter", () => {
  it("is a selectable UI option", () => {
    assert.ok(SELECTED_AI_OPTIONS.some((o) => o.id === OPENROUTER_KIMI_K3_MODEL));
    assert.ok(isValidSelectedAI(OPENROUTER_KIMI_K3_MODEL));
    assert.equal(selectedAILabel(OPENROUTER_KIMI_K3_MODEL), "Kimi K3");
  });

  it("maps legacy kimi slugs to K3", () => {
    assert.equal(resolveSelectedAI("kimi"), OPENROUTER_KIMI_K3_MODEL);
    assert.equal(resolveSelectedAI("kimi-k3"), OPENROUTER_KIMI_K3_MODEL);
    assert.equal(resolveSelectedAI("moonshotai/kimi-latest"), OPENROUTER_KIMI_K3_MODEL);
    assert.equal(resolveOpenRouterModelId(OPENROUTER_KIMI_K3_MODEL), OPENROUTER_KIMI_K3_MODEL);
  });

  it("uses MoonshotAI list pricing", () => {
    assert.ok(isKimiModel(OPENROUTER_KIMI_K3_MODEL));
    const rates = resolveOpenRouterModelRates(OPENROUTER_KIMI_K3_MODEL);
    assert.equal(rates.inputUsdPerM, 3);
    assert.equal(rates.outputUsdPerM, 15);
    assert.equal(rates.cacheReadUsdPerM, 0.3);
  });
});

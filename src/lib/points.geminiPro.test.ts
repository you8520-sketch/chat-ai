import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_GEMINI_PRO_GROSS_MARGIN,
  computeOpenRouterTurnCost,
  computeTurnBilling,
  explainOpenRouterGeminiProTurnCost,
} from "@/lib/points";
import {
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
} from "@/lib/chatModels";

describe("OpenRouter Gemini Pro billing", () => {
  it("uses 55% gross margin floor", () => {
    assert.equal(OPENROUTER_GEMINI_PRO_GROSS_MARGIN, 0.55);
  });

  for (const modelId of [OPENROUTER_GEMINI_25_PRO_MODEL, OPENROUTER_GEMINI_31_PRO_MODEL]) {
    it(`margin charge = rawCost ÷ 0.45 (${modelId})`, () => {
      const explain = explainOpenRouterGeminiProTurnCost(1000, 800, modelId);
      const marginDivisor = 1 - OPENROUTER_GEMINI_PRO_GROSS_MARGIN;
      assert.equal(
        explain.costPlusMarginKrw,
        Math.ceil(explain.rawCostKrw / marginDivisor - 1e-9)
      );
      assert.equal(explain.charFloorKrw, 0);
    });
  }

  it("charges from upstream USD when provided (matches receipt API cost)", () => {
    const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;
    const upstreamCostUsd = 0.066;
    const tokenOnly = explainOpenRouterGeminiProTurnCost(100, 50, modelId);
    const withUpstream = explainOpenRouterGeminiProTurnCost(100, 50, modelId, undefined, {
      upstreamCostUsd,
      apiPromptTokens: 12000,
      apiCompletionTokens: 2500,
    });
    assert.ok(withUpstream.rawCostKrw > tokenOnly.rawCostKrw);
    assert.equal(
      withUpstream.total,
      Math.max(5, Math.ceil(withUpstream.rawCostKrw / 0.45 - 1e-9))
    );
    const billing = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: modelId,
      inputTokens: 8000,
      outputTokens: 400,
      upstreamCostUsd,
      apiPromptTokens: 12000,
      apiCompletionTokens: 2500,
      userContextChars: 0,
    });
    assert.equal(billing.contextSurcharge, 0);
    assert.equal(billing.total, withUpstream.total);
  });

  it("no user note surcharge when note body empty", () => {
    const billing = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: OPENROUTER_GEMINI_31_PRO_MODEL,
      inputTokens: 5000,
      outputTokens: 800,
      userContextChars: 0,
      upstreamCostUsd: 0.05,
      apiPromptTokens: 5000,
      apiCompletionTokens: 800,
    });
    assert.equal(billing.contextSurcharge, 0);
    assert.equal(billing.multiplier, 1);
    assert.equal(billing.total, billing.baseCost);
  });
});

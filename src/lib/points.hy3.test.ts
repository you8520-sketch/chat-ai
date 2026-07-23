import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_MIN_TURN_COST,
  OPENROUTER_TENCENT_HY3_GROSS_MARGIN,
  computeOpenRouterTurnBilling,
  computeOpenRouterTurnCost,
  explainOpenRouterTencentHy3TurnCost,
} from "@/lib/points";
import { resolveOpenRouterBillingRawCostKrw } from "@/lib/billingRawCost";
import { OPENROUTER_TENCENT_HY3_MODEL } from "@/lib/chatModels";

function ceilPoints(value: number): number {
  return value > 0 ? Math.ceil(value - 1e-9) : 0;
}

describe("Tencent Hy3 proportional billing", () => {
  const modelId = OPENROUTER_TENCENT_HY3_MODEL;

  it("uses the shared 65% gross-margin owner", () => {
    assert.equal(OPENROUTER_TENCENT_HY3_GROSS_MARGIN, 0.65);
  });

  it("charges standard list input and output cost divided by 0.35", () => {
    const inputTokens = 17_707;
    const outputTokens = 2013;
    const explain = explainOpenRouterTencentHy3TurnCost(
      inputTokens,
      outputTokens,
      modelId
    );
    const listCostKrw = resolveOpenRouterBillingRawCostKrw({
      promptTokens: inputTokens,
      outputTokens,
      modelId,
    });
    const expected = Math.max(
      OPENROUTER_MIN_TURN_COST,
      ceilPoints(listCostKrw / (1 - OPENROUTER_TENCENT_HY3_GROSS_MARGIN))
    );

    assert.equal(explain.rawCostKrw, listCostKrw);
    assert.equal(explain.charFloorKrw, 0);
    assert.equal(explain.costPlusMarginKrw, expected);
    assert.equal(explain.total, expected);
    assert.equal(computeOpenRouterTurnCost(inputTokens, outputTokens, modelId), expected);
  });

  it("keeps the same charge across cache and provider-cost variations", () => {
    const inputTokens = 20_000;
    const outputTokens = 2000;
    const noCache = computeOpenRouterTurnCost(inputTokens, outputTokens, modelId);
    const cacheHit = computeOpenRouterTurnCost(inputTokens, outputTokens, modelId, {
      cacheReadTokens: 18_000,
    });
    const cheapCached = computeOpenRouterTurnBilling({
      modelId,
      inputTokens,
      outputTokens,
      upstreamCostUsd: 0.001,
    });
    const expensiveUncached = computeOpenRouterTurnBilling({
      modelId,
      inputTokens,
      outputTokens,
      upstreamCostUsd: 0.1,
    });

    assert.equal(cacheHit, noCache);
    assert.equal(cheapCached.total, noCache);
    assert.equal(expensiveUncached.total, noCache);
  });
});

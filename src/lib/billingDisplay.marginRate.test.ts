import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveApiRawCostKrw,
  resolveRealizedMarginRatePercent,
} from "@/lib/billingDisplay";
import { openRouterRawCostKrw } from "@/lib/billingRawCost";
import type { Usage } from "@/lib/chatUsage";
import {
  clearCheaperInferenceCatalogPricingForTest,
  updateCheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";

function baseUsage(over: Partial<Usage> = {}): Usage {
  return {
    input: 1000,
    output: 500,
    model: "gpt-5.6-terra",
    provider: "cheaperinference",
    route: "safe",
    cost: 100,
    apiInputTokens: 1000,
    apiOutputTokens: 500,
    exchangeRateKrwPerUsd: 1500,
    exchangeRateDateKey: "2026-08-02",
    exchangeRateMode: "daily_kst",
    exchangeRateSource: "api",
    breakdown: [],
    ...over,
  };
}

describe("resolveRealizedMarginRatePercent", () => {
  it("uses stored apiRawCostKrw (charge-time snapshot) against deducted points", () => {
    const usage = baseUsage({ apiRawCostKrw: 40, apiRawCostSource: "provider_reported" });
    assert.equal(resolveApiRawCostKrw(usage), 40);
    // 1 - 40/100 = 60%
    assert.equal(resolveRealizedMarginRatePercent(usage, 100), 60);
  });

  it("prefers provider upstream USD when snapshot missing", () => {
    clearCheaperInferenceCatalogPricingForTest();
    const usage = baseUsage({
      apiRawCostKrw: undefined,
      upstreamCostUsd: 0.02, // 0.02 * 1500 = 30 KRW
    });
    assert.equal(resolveApiRawCostKrw(usage), 30);
    assert.equal(resolveRealizedMarginRatePercent(usage, 100), 70);
  });

  it("falls back to published live catalog rates when upstream missing", () => {
    clearCheaperInferenceCatalogPricingForTest();
    updateCheaperInferenceCatalogPricing({
      modelId: "gpt-5.6-terra",
      inputUsdPerMillion: 2.5,
      cacheReadUsdPerMillion: 0.25,
      cacheWriteUsdPerMillion: 2.5,
      outputUsdPerMillion: 15,
      fetchedAt: Date.now(),
    });
    const usage = baseUsage({
      apiRawCostKrw: undefined,
      upstreamCostUsd: undefined,
    });
    const expected = openRouterRawCostKrw({
      promptTokens: 1000,
      outputTokens: 500,
      modelId: "gpt-5.6-terra",
      exchangeRate: {
        effectiveKrwPerUsd: 1500,
        dateKey: "2026-08-02",
        mode: "daily_kst",
        source: "api",
      },
    });
    assert.equal(resolveApiRawCostKrw(usage), expected);
    assert.ok(expected > 0);
    const pct = resolveRealizedMarginRatePercent(usage, 100);
    assert.equal(pct, Math.round((1 - expected / 100) * 100));
    clearCheaperInferenceCatalogPricingForTest();
  });

  it("returns null when deducted points or cost unavailable", () => {
    assert.equal(resolveRealizedMarginRatePercent(baseUsage({ apiRawCostKrw: 10 }), 0), null);
    assert.equal(
      resolveRealizedMarginRatePercent(
        baseUsage({
          apiRawCostKrw: undefined,
          upstreamCostUsd: undefined,
          apiInputTokens: 0,
          apiOutputTokens: 0,
          input: 0,
          output: 0,
        }),
        100
      ),
      null
    );
  });
});

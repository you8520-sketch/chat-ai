import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeUsageForPublicReceipt } from "./billingReceiptAccess";
import type { Usage } from "./chatUsage";

describe("billingReceiptAccess privacy", () => {
  it("strips shadowPricing from public receipt", () => {
    const usage = {
      input: 100,
      output: 200,
      model: "claude-opus-5",
      route: "safe" as const,
      cost: 100,
      breakdown: [],
      shadowPricing: {
        pricingVersion: 1,
        billingReferenceInputRateKrw: 0.01,
        billingReferenceOutputRateKrw: 0.01,
        billingReferenceCostKrw: 10,
        actualProviderCostKrw: 5,
        actualCostSource: "live_catalog_estimated",
        providerListCostKrw: 8,
        inputCostKrw: 5,
        outputCostKrw: 5,
        reasoningCostKrw: 0,
        cacheReadCostKrw: 0,
        cacheWriteCostKrw: 0,
        targetMargin: 0.2,
        minimumMarginFloor: 0.1,
        standardUserChargeKrw: 12,
        promoPercent: 0,
        finalShadowChargeKrw: 12,
        finalShadowPoints: 12,
        providerSavingsKrw: 3,
        providerOverrunKrw: 0,
        promoGivebackKrw: 0,
        netPricingBufferDeltaKrw: 3,
        actualGrossProfitKrw: 7,
        actualRealizedMargin: 0.5,
        worstCasePromoMargin: 0.3,
        marginFloorViolated: false,
      },
    } as unknown as Usage;
    const pub = sanitizeUsageForPublicReceipt(usage);
    assert.equal((pub as unknown as Record<string, unknown>).shadowPricing, undefined);
    assert.equal((pub as unknown as Record<string, unknown>).actualProviderCostKrw, undefined);
  });
});

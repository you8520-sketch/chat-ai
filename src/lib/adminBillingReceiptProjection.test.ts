import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StageUsage } from "@/lib/ai";
import type { Usage } from "@/lib/chatUsage";
import {
  adminActualReferenceConflated,
  aggregateTurnSettledActualUsd,
  buildAdminBillingReceiptProjection,
} from "@/lib/adminBillingReceiptProjection";
import { computeShadowPricing } from "@/lib/shadowPricing";
import { clearCheaperInferenceCatalogPricingForTest, updateCheaperInferenceCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing";
import { sanitizeUsageForPublicReceipt } from "@/lib/billingReceiptAccess";
import { resolveApiRawCostKrw } from "@/lib/billingDisplay";
import { convertUsdToKrw, applyOverseasCardFee } from "@/lib/exchangeRate";

const FX_1405 = {
  mode: "daily_kst" as const,
  dateKey: "2026-08-30",
  usdToKrw: 1377.900275,
  effectiveKrwPerUsd: 1405.4582805,
  source: "api_daily" as const,
};

function stage(partial: Partial<StageUsage> & Pick<StageUsage, "stage" | "model" | "input" | "output">): StageUsage {
  return { estimated: false, ...partial };
}

describe("adminBillingReceiptProjection — CI settled vs reference golden", () => {
  it("ADMIN_ACTUAL_USD=0.0217 ADMIN_REFERENCE_USD=0.0309 ACTUAL_REFERENCE_CONFLATED=false", () => {
    clearCheaperInferenceCatalogPricingForTest();
    updateCheaperInferenceCatalogPricing({
      modelId: "google/gemini-3.7-flash",
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 3,
      referenceInputUsdPerMillion: 0.7,
      referenceOutputUsdPerMillion: 4.5,
      discountPercent: 28,
      fetchedAt: Date.now(),
    });

    const stages = [
      stage({
        stage: "openRouterAdult",
        model: "google/gemini-3.7-flash",
        input: 24_000,
        output: 2_500,
        apiOutputTokens: 2_500,
        cheaperInferenceBilledCostUsd: 0.0217,
        upstreamCostUsd: 0.0309,
      }),
    ];

    const shadow = computeShadowPricing({
      modelId: "google/gemini-3.7-flash",
      promptTokens: 24_000,
      outputTokens: 2_500,
      cheaperInferenceBilledCostUsd: 0.0217,
      upstreamCostUsd: 0.0309,
    });

    const usage: Usage = {
      input: 24_000,
      output: 2_500,
      model: "google/gemini-3.7-flash",
      provider: "cheaperinference",
      route: "safe",
      cost: 48,
      savedOutputChars: 9000,
      upstreamCostUsd: 0.0309,
      apiRawCostKrw: convertUsdToKrw(0.0309, FX_1405.effectiveKrwPerUsd),
      apiRawCostSource: "provider_reported",
    };

    const projection = buildAdminBillingReceiptProjection({
      usage,
      stages,
      billableStageLabels: new Set(["openRouterAdult"]),
      provider: "cheaperinference",
      modelId: "google/gemini-3.7-flash",
      modelLabel: "Gemini 3.7 Flash",
      exchangeRate: FX_1405,
      shadowPricing: {
        pricingVersion: shadow.pricingVersion,
        billingReferenceInputUsdPerMillion: shadow.billingReferenceInputUsdPerMillion,
        billingReferenceOutputUsdPerMillion: shadow.billingReferenceOutputUsdPerMillion,
        billingReferenceCostKrw: shadow.billingReferenceCostKrw,
        billingReferenceCostUsd: shadow.billingReferenceCostUsd,
        fxSnapshot: shadow.fxSnapshot,
        providerListCostStatus: shadow.providerListCostStatus,
        reserveStatus: shadow.reserveStatus,
        actualProviderCostKrw: shadow.actualProviderCostKrw,
        actualCostSource: shadow.actualCostSource,
        providerListCostKrw: shadow.providerListCostKrw,
        inputCostKrw: shadow.inputCostKrw,
        outputCostKrw: shadow.outputCostKrw,
        reasoningCostKrw: shadow.reasoningCostKrw,
        cacheReadCostKrw: shadow.cacheReadCostKrw,
        cacheWriteCostKrw: shadow.cacheWriteCostKrw,
        targetMargin: shadow.targetMargin,
        minimumMarginFloor: shadow.minimumMarginFloor,
        standardUserChargeKrw: shadow.standardUserChargeKrw,
        promoPercent: 0,
        finalShadowChargeKrw: shadow.finalShadowChargeKrw,
        finalShadowPoints: shadow.finalShadowPoints,
        providerSavingsKrw: shadow.providerSavingsKrw,
        providerOverrunKrw: shadow.providerOverrunKrw,
        promoGivebackKrw: shadow.promoGivebackKrw,
        netPricingBufferDeltaKrw: shadow.netPricingBufferDeltaKrw,
        actualGrossProfitKrw: shadow.actualGrossProfitKrw,
        actualRealizedMargin: shadow.actualRealizedMargin,
        worstCasePromoMargin: shadow.worstCasePromoMargin,
        marginFloorViolated: shadow.marginFloorViolated,
      },
    });

    assert.equal(projection.providerActualSettlement.actualProviderCostUsd, 0.0217);
    assert.ok(projection.providerListReference.providerListCostUsd != null);
    assert.notEqual(
      projection.providerActualSettlement.actualProviderCostUsd,
      projection.providerListReference.providerListCostUsd
    );
    assert.equal(adminActualReferenceConflated(projection), false);

    const baseActualKrw = convertUsdToKrw(0.0217, FX_1405.effectiveKrwPerUsd);
    assert.ok(Math.abs((projection.providerActualSettlement.baseActualKrw ?? 0) - Math.round(baseActualKrw * 10) / 10) < 0.2);
    const effectiveCash = applyOverseasCardFee(Math.round(baseActualKrw * 10) / 10);
    assert.ok(
      Math.abs((projection.providerActualSettlement.effectiveProviderCashCostKrw ?? 0) - effectiveCash) < 0.2
    );

    assert.notEqual(resolveApiRawCostKrw(usage), projection.providerActualSettlement.baseActualKrw);

    clearCheaperInferenceCatalogPricingForTest();
  });
});

describe("adminBillingReceiptProjection — multi-call aggregation", () => {
  it("primary + retry sums settled actual; partial when one call unsettled", () => {
    const stages = [
      stage({
        stage: "primary-refused",
        model: "google/gemini-3.7-flash",
        input: 8000,
        output: 100,
        cheaperInferenceBilledCostUsd: 0.005,
        upstreamCostUsd: 0.008,
      }),
      stage({
        stage: "fallback",
        model: "google/gemini-3.7-flash",
        input: 9000,
        output: 700,
        apiOutputTokens: 700,
        cheaperInferenceBilledCostUsd: 0.0167,
        upstreamCostUsd: 0.0229,
      }),
    ];
    const complete = aggregateTurnSettledActualUsd(stages);
    assert.equal(complete.coverage, "complete");
    assert.equal(complete.totalUsd, 0.0217);

    const partialStages = [
      ...stages,
      stage({
        stage: "server-under-length-recovery",
        model: "google/gemini-3.7-flash",
        input: 9500,
        output: 400,
        apiOutputTokens: 400,
        upstreamCostUsd: 0.01,
      }),
    ];
    const partial = aggregateTurnSettledActualUsd(partialStages);
    assert.equal(partial.coverage, "partial");
    assert.equal(partial.totalUsd, 0.0217);
  });
});

describe("adminBillingReceiptProjection — privacy boundary", () => {
  it("adminBillingReceipt stripped from public receipt", () => {
    const usage: Usage = {
      input: 100,
      output: 50,
      model: "google/gemini-3.7-flash",
      route: "safe",
      cost: 10,
      adminBillingReceipt: buildAdminBillingReceiptProjection({
        usage: {
          input: 100,
          output: 50,
          model: "google/gemini-3.7-flash",
          route: "safe",
          cost: 10,
        },
        stages: [
          stage({
            stage: "primary",
            model: "google/gemini-3.7-flash",
            input: 100,
            output: 50,
            cheaperInferenceBilledCostUsd: 0.01,
          }),
        ],
        billableStageLabels: new Set(["primary"]),
        provider: "cheaperinference",
        modelId: "google/gemini-3.7-flash",
        modelLabel: "Gemini 3.7 Flash",
        exchangeRate: FX_1405,
      }),
    };
    const pub = sanitizeUsageForPublicReceipt(usage);
    assert.equal("adminBillingReceipt" in pub, false);
  });
});

describe("adminBillingReceiptProjection — partial coverage economics", () => {
  it("partial coverage yields null internalEconomics", () => {
    const projection = buildAdminBillingReceiptProjection({
      usage: {
        input: 1000,
        output: 200,
        model: "google/gemini-3.7-flash",
        route: "safe",
        cost: 20,
      },
      stages: [
        stage({
          stage: "primary",
          model: "google/gemini-3.7-flash",
          input: 1000,
          output: 200,
          cheaperInferenceBilledCostUsd: 0.01,
        }),
        stage({
          stage: "recovery",
          model: "google/gemini-3.7-flash",
          input: 1100,
          output: 150,
          upstreamCostUsd: 0.012,
        }),
      ],
      billableStageLabels: new Set(["primary"]),
      provider: "cheaperinference",
      modelId: "google/gemini-3.7-flash",
      modelLabel: "Gemini 3.7 Flash",
      exchangeRate: FX_1405,
    });
    assert.equal(projection.providerActualSettlement.actualCostCoverage, "partial");
    assert.equal(projection.internalEconomics, null);
  });
});

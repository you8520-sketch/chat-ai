import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StageUsage } from "@/lib/ai";
import type { Usage } from "@/lib/chatUsage";
import {
  buildAdminBillingReceiptProjection,
  reproducesDoubleCardFee,
  resolveStatusWidgetAuxiliaryCost,
  resolveWholeTurnActualCostCoverage,
  summarizeStageSettledActualUsd,
} from "@/lib/adminBillingReceiptProjection";
import { sanitizeUsageForPublicReceipt } from "@/lib/billingReceiptAccess";
import { computeShadowPricing } from "@/lib/shadowPricing";
import {
  clearCheaperInferenceCatalogPricingForTest,
  updateCheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";
import { convertUsdToKrw, applyOverseasCardFee } from "@/lib/exchangeRate";

const FX_1405 = {
  mode: "daily_kst" as const,
  dateKey: "2026-08-30",
  usdToKrw: 1377.900275,
  effectiveKrwPerUsd: 1405.4582805,
  source: "api" as const,
};

function stage(partial: Partial<StageUsage> & Pick<StageUsage, "stage" | "model" | "input" | "output">): StageUsage {
  return { estimated: false, ...partial };
}

function shadowFromGolden() {
  return computeShadowPricing({
    modelId: "google/gemini-3.7-flash",
    promptTokens: 24_000,
    outputTokens: 2_500,
    cheaperInferenceBilledCostUsd: 0.0217,
    upstreamCostUsd: 0.0309,
    actualTurnCostCoverage: "complete",
  });
}

describe("R1/R13 golden — CI settled vs reference + FX", () => {
  it("ADMIN_ACTUAL=0.0217 BASE_KRW~29.9 EFFECTIVE~30.5 CARD_FEE_ONCE", () => {
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
    const shadow = shadowFromGolden();

    const projection = buildAdminBillingReceiptProjection({
      usage: {
        input: 24_000,
        output: 2_500,
        model: "google/gemini-3.7-flash",
        provider: "cheaperinference",
        route: "safe",
        cost: 48,
        savedOutputChars: 9000,
      },
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
      mainTurnCoverage: "complete",
    });

    assert.equal(projection.providerActualSettlement.actualProviderCostUsd, 0.0217);
    assert.notEqual(
      projection.providerActualSettlement.actualProviderCostUsd,
      projection.providerListReference.providerListCostUsd
    );
    assert.equal(projection.providerActualSettlement.actualCostCoverage, "complete");

    const expectedBase = Math.round(0.0217 * FX_1405.usdToKrw * 10) / 10;
    const expectedEffective = convertUsdToKrw(0.0217, FX_1405.effectiveKrwPerUsd);
    assert.ok(Math.abs((projection.providerActualSettlement.baseActualKrw ?? 0) - expectedBase) < 0.15);
    assert.ok(
      Math.abs((projection.providerActualSettlement.effectiveProviderCashCostKrw ?? 0) - expectedEffective) <
        0.15
    );
    assert.equal(reproducesDoubleCardFee(projection), false);
    assert.notEqual(
      projection.providerActualSettlement.effectiveProviderCashCostKrw,
      applyOverseasCardFee(projection.providerActualSettlement.baseActualKrw ?? 0)
    );

    clearCheaperInferenceCatalogPricingForTest();
  });
});

describe("R2/R3 — BEFORE double card fee reproduced on old formula", () => {
  it("DOUBLE_CARD_FEE_REPRODUCED=true for effective×fee stacking", () => {
    const wrongBase = convertUsdToKrw(0.0217, FX_1405.effectiveKrwPerUsd);
    const wrongEffective = applyOverseasCardFee(wrongBase);
    assert.ok(Math.abs(wrongEffective - 31.1) < 0.2, "old bug landed near 31.1 KRW");
    const correctEffective = convertUsdToKrw(0.0217, FX_1405.effectiveKrwPerUsd);
    assert.ok(Math.abs(correctEffective - 30.5) < 0.15);
    assert.notEqual(wrongEffective, correctEffective);
  });
});

describe("R6/R7 — whole-turn coverage owner", () => {
  it("hidden fallback prevents admin complete", () => {
    const stages = [
      stage({
        stage: "primary",
        model: "google/gemini-3.7-flash",
        input: 1000,
        output: 200,
        cheaperInferenceBilledCostUsd: 0.01,
      }),
    ];
    const summary = summarizeStageSettledActualUsd(stages, "cheaperinference");
    assert.equal(
      resolveWholeTurnActualCostCoverage({
        mainTurnCoverage: "partial",
        stageSummary: summary,
        auxiliary: null,
      }),
      "partial"
    );
  });

  it("recovery stage without settled forces partial whole-turn", () => {
    const projection = buildAdminBillingReceiptProjection({
      usage: { input: 1000, output: 200, model: "google/gemini-3.7-flash", route: "safe", cost: 20 },
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
      mainTurnCoverage: "complete",
    });
    assert.equal(projection.providerActualSettlement.actualCostCoverage, "partial");
    assert.equal(projection.internalEconomics, null);
  });
});

describe("R4/R5 — widget auxiliary costs", () => {
  it("main + widget exact upstream sums whole-turn actual", () => {
    const projection = buildAdminBillingReceiptProjection({
      usage: {
        input: 1000,
        output: 200,
        model: "google/gemini-3.7-flash",
        provider: "cheaperinference",
        route: "safe",
        cost: 62,
        baseCost: 60,
        widgetCostPoints: 2,
        statusWidgetExtract: {
          model: "google/gemini-2.5-flash",
          modelLabel: "Gemini 2.5 Flash (상태창 추출)",
          input: 500,
          output: 80,
          apiRawCostKrw: 1.5,
          callCount: 1,
          upstreamCostUsd: 0.001,
          estimated: false,
        },
      },
      stages: [
        stage({
          stage: "primary",
          model: "google/gemini-3.7-flash",
          input: 1000,
          output: 200,
          cheaperInferenceBilledCostUsd: 0.0217,
        }),
      ],
      billableStageLabels: new Set(["primary"]),
      provider: "cheaperinference",
      modelId: "google/gemini-3.7-flash",
      modelLabel: "Gemini 3.7 Flash",
      exchangeRate: FX_1405,
      mainTurnCoverage: "complete",
    });
    assert.equal(projection.providerActualSettlement.actualProviderCostUsd, 0.0227);
    assert.equal(projection.providerCalls.length, 2);
    assert.equal(projection.providerActualSettlement.actualCostCoverage, "complete");
  });

  it("main exact + widget unknown forces partial economics", () => {
    const aux = resolveStatusWidgetAuxiliaryCost({
      model: "widget",
      modelLabel: "widget",
      input: 100,
      output: 20,
      apiRawCostKrw: 2,
      callCount: 1,
      estimated: true,
    });
    assert.equal(aux?.settlementStatus, "ESTIMATED_ONLY");

    const projection = buildAdminBillingReceiptProjection({
      usage: {
        input: 1000,
        output: 200,
        model: "google/gemini-3.7-flash",
        provider: "cheaperinference",
        route: "safe",
        cost: 62,
        statusWidgetExtract: {
          model: "widget",
          modelLabel: "widget",
          input: 100,
          output: 20,
          apiRawCostKrw: 2,
          callCount: 1,
          estimated: true,
        },
      },
      stages: [
        stage({
          stage: "primary",
          model: "google/gemini-3.7-flash",
          input: 1000,
          output: 200,
          cheaperInferenceBilledCostUsd: 0.0217,
        }),
      ],
      billableStageLabels: new Set(["primary"]),
      provider: "cheaperinference",
      modelId: "google/gemini-3.7-flash",
      modelLabel: "Gemini 3.7 Flash",
      exchangeRate: FX_1405,
      mainTurnCoverage: "complete",
    });
    assert.equal(projection.providerActualSettlement.actualCostCoverage, "partial");
    assert.equal(projection.internalEconomics, null);
  });
});

describe("R11 — tiny USD precision preserved", () => {
  it("0.00004 USD is not lost in aggregation", () => {
    const stages = [
      stage({
        stage: "primary",
        model: "google/gemini-3.7-flash",
        input: 10,
        output: 5,
        cheaperInferenceBilledCostUsd: 0.00004,
      }),
    ];
    const summary = summarizeStageSettledActualUsd(stages, "cheaperinference");
    assert.equal(summary.totalSettledUsd, 0.00004);
  });
});

describe("R13 — waived turn", () => {
  it("waived turn has null internal economics", () => {
    const projection = buildAdminBillingReceiptProjection({
      usage: {
        input: 100,
        output: 50,
        model: "google/gemini-3.7-flash",
        route: "safe",
        cost: 0,
        billingWaived: true,
        billingWaiverReason: "promo",
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
      mainTurnCoverage: "complete",
    });
    assert.equal(projection.userCharge.waived, true);
    assert.equal(projection.internalEconomics, null);
  });
});

describe("R14 — public serialization privacy", () => {
  const INTERNAL_FIELDS = [
    "apiRawCostKrw",
    "apiRawCostSource",
    "mainApiRawCostKrw",
    "normalizedRawCostKrw",
    "upstreamCostUsd",
    "cacheDiscountUsd",
    "exchangeRateKrwPerUsd",
    "shadowPricing",
    "adminBillingReceipt",
    "widgetCostPoints",
    "baseCost",
  ] as const;

  it("strips internal economics from serialized public usage", () => {
    const usage: Usage = {
      input: 100,
      output: 50,
      model: "google/gemini-3.7-flash",
      route: "safe",
      cost: 10,
      apiRawCostKrw: 30,
      apiRawCostSource: "provider_reported",
      upstreamCostUsd: 0.02,
      exchangeRateKrwPerUsd: 1405,
      adminBillingReceipt: buildAdminBillingReceiptProjection({
        usage: { input: 100, output: 50, model: "google/gemini-3.7-flash", route: "safe", cost: 10 },
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
        mainTurnCoverage: "complete",
      }),
    };
    const pub = sanitizeUsageForPublicReceipt(usage) as Record<string, unknown>;
    for (const field of INTERNAL_FIELDS) {
      assert.equal(pub[field], undefined, `public leak: ${field}`);
    }
    assert.equal(pub.input, 100);
    assert.equal(pub.output, 50);
    assert.equal(pub.cost, 10);
  });
});

describe("R8/R9 — multi-call aggregation", () => {
  it("multiple settled calls sum; one unsettled → partial", () => {
    const stages = [
      stage({
        stage: "primary-refused",
        model: "google/gemini-3.7-flash",
        input: 8000,
        output: 100,
        cheaperInferenceBilledCostUsd: 0.005,
      }),
      stage({
        stage: "fallback",
        model: "google/gemini-3.7-flash",
        input: 9000,
        output: 700,
        cheaperInferenceBilledCostUsd: 0.0167,
      }),
    ];
    const complete = summarizeStageSettledActualUsd(stages, "cheaperinference");
    assert.equal(complete.allStagesSettled, true);
    assert.equal(complete.totalSettledUsd, 0.0217);

    const partialStages = [
      ...stages,
      stage({
        stage: "server-under-length-recovery",
        model: "google/gemini-3.7-flash",
        input: 9500,
        output: 400,
        upstreamCostUsd: 0.01,
      }),
    ];
    const partial = summarizeStageSettledActualUsd(partialStages, "cheaperinference");
    assert.equal(partial.allStagesSettled, false);
    assert.equal(partial.totalSettledUsd, 0.0217);
  });
});

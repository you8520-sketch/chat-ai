import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAdminBillingReceiptV2,
  adminReceiptExactnessLabel,
} from "@/lib/adminBillingReceiptV2";
import { sanitizeUsageForPublicReceipt } from "@/lib/billingReceiptAccess";
import type { Usage } from "@/lib/chatUsage";
import { applyOverseasCardFee } from "@/lib/billingFxPolicy";
import { convertUsdToKrw } from "@/lib/exchangeRate";
import {
  buildStatusWidgetExtractReceipt,
  mergeStatusWidgetExtractUsages,
} from "@/lib/statusWidget/receiptUsage";
import { computeShadowPricing } from "@/lib/shadowPricing";
import {
  resolveSyncExtractActualCost,
  resolveSyncExtractActualCostFromAggregate,
} from "@/lib/syncExtractActualCost";
import { OPENROUTER_GEMINI_25_FLASH_MODEL } from "@/lib/chatModels";

const FX = {
  mode: "daily_kst" as const,
  dateKey: "2026-08-30",
  usdToKrw: 1530,
  effectiveKrwPerUsd: applyOverseasCardFee(1530),
  source: "api" as const,
};

function baseUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 1000,
    output: 500,
    model: "deepseek/deepseek-v4-pro",
    modelLabel: "DeepSeek V4 Pro",
    provider: "cheaperinference",
    route: "nsfw",
    cost: 80,
    baseCost: 80,
    breakdown: [],
    apiInputTokens: 1000,
    apiOutputTokens: 500,
    ...overrides,
  };
}

describe("syncExtractActualCost", () => {
  it("T1 — pure shared CI exact", () => {
    const p = resolveSyncExtractActualCost(
      [{ cheaperInferenceBilledCostUsd: 0.001 }],
      FX.effectiveKrwPerUsd
    );
    assert.equal(p.actualCostSource, "cheaper_inference_billed");
    assert.equal(p.actualCostCoverage, "complete");
    assert.equal(p.actualProviderCostUsd, 0.001);
    assert.equal(p.physicalCallCount, 1);
  });

  it("T2 — shared + repair all exact", () => {
    const merged = mergeStatusWidgetExtractUsages([
      { inputTokens: 100, outputTokens: 50, estimated: false, cheaperInferenceBilledCostUsd: 0.001 },
      { inputTokens: 80, outputTokens: 40, estimated: false, cheaperInferenceBilledCostUsd: 0.0007 },
    ]);
    assert.ok(Math.abs((merged?.cheaperInferenceBilledCostUsd ?? 0) - 0.0017) < 1e-9);
    assert.equal(merged?.syncExtractCiBilledCallCount, 2);

    const p = resolveSyncExtractActualCost(
      [
        { cheaperInferenceBilledCostUsd: 0.001 },
        { cheaperInferenceBilledCostUsd: 0.0007 },
      ],
      FX.effectiveKrwPerUsd
    );
    assert.ok(Math.abs((p.actualProviderCostUsd ?? 0) - 0.0017) < 1e-9);
    assert.equal(p.actualCostCoverage, "complete");
    assert.equal(p.physicalCallCount, 2);
  });

  it("T3 — shared + repair one missing billed", () => {
    const p = resolveSyncExtractActualCost(
      [{ cheaperInferenceBilledCostUsd: 0.001 }, { upstreamCostUsd: 0.002 }],
      FX.effectiveKrwPerUsd
    );
    assert.equal(p.actualCostCoverage, "partial");
    assert.equal(p.actualProviderCostUsd, 0.001);
    assert.equal(p.billedCallCount, 1);
  });

  it("T4 — CI billed beats upstream on aggregate", () => {
    const receipt = buildStatusWidgetExtractReceipt(
      mergeStatusWidgetExtractUsages([
        {
          inputTokens: 100,
          outputTokens: 50,
          estimated: false,
          cheaperInferenceBilledCostUsd: 0.01,
          upstreamCostUsd: 0.02,
        },
      ])!,
      FX,
      { modelId: OPENROUTER_GEMINI_25_FLASH_MODEL, callCount: 1, postTurnSharedInitial: true }
    );
    assert.equal(receipt.actualProviderCostUsd, 0.01);
    assert.notEqual(receipt.actualProviderCostUsd, 0.02);
  });
});

describe("adminBillingReceiptV2", () => {
  it("T5 — Main CI settled exact", () => {
    const shadow = computeShadowPricing({
      modelId: "deepseek/deepseek-v4-pro",
      promptTokens: 1000,
      outputTokens: 500,
      cheaperInferenceBilledCostUsd: 0.02,
      upstreamCostUsd: 0.03,
      actualTurnCostCoverage: "complete",
    });
    const receipt = buildAdminBillingReceiptV2(
      baseUsage({
        shadowPricing: {
          pricingVersion: shadow.pricingVersion,
          billingReferenceInputUsdPerMillion: shadow.billingReferenceInputUsdPerMillion,
          billingReferenceOutputUsdPerMillion: shadow.billingReferenceOutputUsdPerMillion,
          billingReferenceCostKrw: shadow.billingReferenceCostKrw,
          billingReferenceCostUsd: shadow.billingReferenceCostUsd,
          fxSnapshot: shadow.fxSnapshot,
          providerListCostStatus: shadow.providerListCostStatus,
          reserveStatus: shadow.reserveStatus,
          actualTurnCostCoverage: shadow.actualTurnCostCoverage,
          actualProviderCostKrw: shadow.actualProviderCostKrw,
          actualCostUsd: shadow.actualCostUsd,
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
      })
    );
    assert.equal(receipt.mainRp.actual?.actualCostSource, "cheaper_inference_billed");
    assert.equal(receipt.mainRp.actual?.exactness, "settled");
    assert.equal(receipt.mainRp.actual?.actualProviderCostUsd, 0.02);
  });

  it("T6 — Main partial coverage is not settled", () => {
    const receipt = buildAdminBillingReceiptV2(
      baseUsage({
        shadowPricing: {
          pricingVersion: 1,
          billingReferenceInputUsdPerMillion: 1,
          billingReferenceOutputUsdPerMillion: 2,
          billingReferenceCostKrw: 10,
          billingReferenceCostUsd: 0.01,
          fxSnapshot: {
            dateKey: "2026-08-30",
            source: "api_daily",
            baseUsdKrw: 1530,
            overseasFeeRate: 0.02,
            effectiveKrwPerUsd: FX.effectiveKrwPerUsd,
          },
          providerListCostStatus: "complete",
          reserveStatus: "estimated",
          actualTurnCostCoverage: "partial",
          actualProviderCostKrw: 30,
          actualCostUsd: 0.02,
          actualCostSource: "cheaper_inference_billed",
          providerListCostKrw: 35,
          inputCostKrw: 5,
          outputCostKrw: 5,
          reasoningCostKrw: 0,
          cacheReadCostKrw: 0,
          cacheWriteCostKrw: 0,
          targetMargin: 0.5,
          minimumMarginFloor: 0.3,
          standardUserChargeKrw: 80,
          promoPercent: 0,
          finalShadowChargeKrw: 80,
          finalShadowPoints: 80,
          providerSavingsKrw: null,
          providerOverrunKrw: null,
          promoGivebackKrw: 0,
          netPricingBufferDeltaKrw: null,
          actualGrossProfitKrw: 50,
          actualRealizedMargin: 0.625,
          worstCasePromoMargin: null,
          marginFloorViolated: null,
        },
      })
    );
    assert.equal(receipt.mainRp.actual?.exactness, "partial");
    assert.equal(receipt.mainRp.marginPercent, null);
  });

  it("T7 — catalog estimate is not settled", () => {
    const receipt = buildAdminBillingReceiptV2(
      baseUsage({
        shadowPricing: {
          pricingVersion: 1,
          billingReferenceInputUsdPerMillion: 1,
          billingReferenceOutputUsdPerMillion: 2,
          billingReferenceCostKrw: 10,
          billingReferenceCostUsd: 0.01,
          fxSnapshot: {
            dateKey: "2026-08-30",
            source: "api_daily",
            baseUsdKrw: 1530,
            overseasFeeRate: 0.02,
            effectiveKrwPerUsd: FX.effectiveKrwPerUsd,
          },
          providerListCostStatus: "complete",
          reserveStatus: "estimated",
          actualTurnCostCoverage: "complete",
          actualProviderCostKrw: 30,
          actualCostSource: "live_catalog_estimated",
          providerListCostKrw: 35,
          inputCostKrw: 5,
          outputCostKrw: 5,
          reasoningCostKrw: 0,
          cacheReadCostKrw: 0,
          cacheWriteCostKrw: 0,
          targetMargin: 0.5,
          minimumMarginFloor: 0.3,
          standardUserChargeKrw: 80,
          promoPercent: 0,
          finalShadowChargeKrw: 80,
          finalShadowPoints: 80,
          providerSavingsKrw: null,
          providerOverrunKrw: null,
          promoGivebackKrw: 0,
          netPricingBufferDeltaKrw: null,
          actualGrossProfitKrw: 50,
          actualRealizedMargin: 0.625,
          worstCasePromoMargin: null,
          marginFloorViolated: null,
        },
      })
    );
    assert.equal(receipt.mainRp.actual?.exactness, "estimated");
    assert.notEqual(adminReceiptExactnessLabel(receipt.mainRp.actual!.exactness), "정산 확정");
  });

  it("T31 — FX card fee applied once", () => {
    const effective = applyOverseasCardFee(1530);
    const expectedKrw = Math.round(convertUsdToKrw(0.02, effective) * 10) / 10;
    const p = resolveSyncExtractActualCostFromAggregate(
      {
        cheaperInferenceBilledCostUsd: 0.02,
        physicalCallCount: 1,
        billedCallCount: 1,
      },
      effective
    );
    assert.equal(p.actualProviderCostKrw, expectedKrw);
    assert.ok(Math.abs(expectedKrw - 31.2) < 0.1);
  });

  it("T32 — user charge separate from sync platform spend", () => {
    const receipt = buildAdminBillingReceiptV2(
      baseUsage({
        cost: 80,
        shadowPricing: {
          pricingVersion: 1,
          billingReferenceInputUsdPerMillion: 1,
          billingReferenceOutputUsdPerMillion: 2,
          billingReferenceCostKrw: 10,
          billingReferenceCostUsd: 0.01,
          fxSnapshot: {
            dateKey: "2026-08-30",
            source: "api_daily",
            baseUsdKrw: 1530,
            overseasFeeRate: 0.02,
            effectiveKrwPerUsd: FX.effectiveKrwPerUsd,
          },
          providerListCostStatus: "complete",
          reserveStatus: "complete",
          actualTurnCostCoverage: "complete",
          actualProviderCostKrw: 30,
          actualCostUsd: 0.02,
          actualCostSource: "cheaper_inference_billed",
          providerListCostKrw: 35,
          inputCostKrw: 5,
          outputCostKrw: 5,
          reasoningCostKrw: 0,
          cacheReadCostKrw: 0,
          cacheWriteCostKrw: 0,
          targetMargin: 0.5,
          minimumMarginFloor: 0.3,
          standardUserChargeKrw: 80,
          promoPercent: 0,
          finalShadowChargeKrw: 80,
          finalShadowPoints: 80,
          providerSavingsKrw: null,
          providerOverrunKrw: null,
          promoGivebackKrw: 0,
          netPricingBufferDeltaKrw: null,
          actualGrossProfitKrw: 50,
          actualRealizedMargin: 0.625,
          worstCasePromoMargin: null,
          marginFloorViolated: null,
        },
        statusWidgetExtract: {
          model: OPENROUTER_GEMINI_25_FLASH_MODEL,
          modelLabel: "Gemini (공유 초기)",
          input: 100,
          output: 50,
          apiRawCostKrw: 4,
          callCount: 1,
          postTurnSharedInitial: true,
          actualProviderCostUsd: 0.001,
          actualProviderCostKrw: 4,
          actualCostSource: "cheaper_inference_billed",
          actualCostCoverage: "complete",
        },
      })
    );
    assert.equal(receipt.userCharge.deductedPoints, 80);
    assert.equal(receipt.mainRp.actual?.actualProviderCostKrw, 30);
    assert.equal(receipt.syncPlatformSpend.actualProviderCostKrw, 4);
    assert.notEqual(receipt.userCharge.deductedPoints, 84);
  });

  it("T33 — missing aux is not zero", () => {
    const receipt = buildAdminBillingReceiptV2(
      baseUsage({
        shadowPricing: {
          pricingVersion: 1,
          billingReferenceInputUsdPerMillion: 1,
          billingReferenceOutputUsdPerMillion: 2,
          billingReferenceCostKrw: 10,
          billingReferenceCostUsd: 0.01,
          fxSnapshot: {
            dateKey: "2026-08-30",
            source: "api_daily",
            baseUsdKrw: 1530,
            overseasFeeRate: 0.02,
            effectiveKrwPerUsd: FX.effectiveKrwPerUsd,
          },
          providerListCostStatus: "complete",
          reserveStatus: "complete",
          actualTurnCostCoverage: "complete",
          actualProviderCostKrw: 30,
          actualCostUsd: 0.02,
          actualCostSource: "cheaper_inference_billed",
          providerListCostKrw: 35,
          inputCostKrw: 5,
          outputCostKrw: 5,
          reasoningCostKrw: 0,
          cacheReadCostKrw: 0,
          cacheWriteCostKrw: 0,
          targetMargin: 0.5,
          minimumMarginFloor: 0.3,
          standardUserChargeKrw: 80,
          promoPercent: 0,
          finalShadowChargeKrw: 80,
          finalShadowPoints: 80,
          providerSavingsKrw: null,
          providerOverrunKrw: null,
          promoGivebackKrw: 0,
          netPricingBufferDeltaKrw: null,
          actualGrossProfitKrw: 50,
          actualRealizedMargin: 0.625,
          worstCasePromoMargin: null,
          marginFloorViolated: null,
        },
      })
    );
    assert.equal(receipt.syncPlatformSpend.status, "not_persisted");
    assert.equal(receipt.capturedSyncProviderSpendKrw, null);
  });

  it("T34 — historical legacy row without shadow snapshot", () => {
    const receipt = buildAdminBillingReceiptV2(
      baseUsage({
        apiRawCostKrw: 25,
        upstreamCostUsd: 0.015,
      })
    );
    assert.equal(receipt.snapshotAvailable, false);
    assert.equal(receipt.mainRp.actual, null);
    assert.match(receipt.historicalNote ?? "", /정확한 정산 스냅샷/);
  });

  it("T35 — public strips new internal economics", () => {
    const admin = baseUsage({
      shadowPricing: {
        pricingVersion: 1,
        billingReferenceInputUsdPerMillion: 1,
        billingReferenceOutputUsdPerMillion: 2,
        billingReferenceCostKrw: 10,
        billingReferenceCostUsd: 0.01,
        fxSnapshot: {
          dateKey: "2026-08-30",
          source: "api_daily",
          baseUsdKrw: 1530,
          overseasFeeRate: 0.02,
          effectiveKrwPerUsd: FX.effectiveKrwPerUsd,
        },
        providerListCostStatus: "complete",
        reserveStatus: "complete",
        actualTurnCostCoverage: "complete",
        actualProviderCostKrw: 30,
        actualCostUsd: 0.02,
        actualCostSource: "cheaper_inference_billed",
        providerListCostKrw: 35,
        inputCostKrw: 5,
        outputCostKrw: 5,
        reasoningCostKrw: 0,
        cacheReadCostKrw: 0,
        cacheWriteCostKrw: 0,
        targetMargin: 0.5,
        minimumMarginFloor: 0.3,
        standardUserChargeKrw: 80,
        promoPercent: 0,
        finalShadowChargeKrw: 80,
        finalShadowPoints: 80,
        providerSavingsKrw: null,
        providerOverrunKrw: null,
        promoGivebackKrw: 0,
        netPricingBufferDeltaKrw: null,
        actualGrossProfitKrw: 50,
        actualRealizedMargin: 0.625,
        worstCasePromoMargin: null,
        marginFloorViolated: null,
      },
      statusWidgetExtract: {
        model: OPENROUTER_GEMINI_25_FLASH_MODEL,
        modelLabel: "Gemini",
        input: 100,
        output: 50,
        apiRawCostKrw: 4,
        actualProviderCostUsd: 0.001,
        actualProviderCostKrw: 4,
        actualCostSource: "cheaper_inference_billed",
        actualCostCoverage: "complete",
      },
    });
    const pub = sanitizeUsageForPublicReceipt(admin);
    assert.equal(pub.shadowPricing, undefined);
    assert.equal(pub.statusWidgetExtract, undefined);
    assert.equal((pub as Record<string, unknown>).actualCostUsd, undefined);
    assert.ok(admin.shadowPricing?.actualCostUsd);
    assert.ok(admin.statusWidgetExtract?.actualProviderCostUsd);
  });

  it("scope is captured sync — no whole-turn label", () => {
    const receipt = buildAdminBillingReceiptV2(baseUsage());
    assert.equal(receipt.scope, "captured_sync");
  });
});

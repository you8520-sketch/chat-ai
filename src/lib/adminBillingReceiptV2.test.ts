import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAdminBillingReceiptV2,
  adminReceiptExactnessLabel,
  formatAdminActualUsd,
  formatAdminKrwFromUsd,
  formatAdminBillingReceiptV2Text,
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

const SHADOW_FX = {
  dateKey: "2026-08-30",
  source: "api_daily" as const,
  baseUsdKrw: 1600,
  overseasFeeRate: 0.02,
  effectiveKrwPerUsd: 1600,
};

const LEGACY_FX_EFFECTIVE = 1500;

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

function shadowFixture(overrides: Partial<NonNullable<Usage["shadowPricing"]>> = {}) {
  return {
    pricingVersion: 1,
    billingReferenceInputUsdPerMillion: 1,
    billingReferenceOutputUsdPerMillion: 2,
    billingReferenceCostKrw: 10,
    billingReferenceCostUsd: 0.01,
    fxSnapshot: SHADOW_FX,
    providerListCostStatus: "complete",
    reserveStatus: "complete",
    actualTurnCostCoverage: "complete" as const,
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
    modelId: "deepseek/deepseek-v4-pro",
    provider: "cheaperinference",
    ...overrides,
  };
}

describe("nested syncExtractActualCost", () => {
  it("R1/N1 — nested aggregate all exact", () => {
    const inner = mergeStatusWidgetExtractUsages([
      { inputTokens: 100, outputTokens: 50, estimated: false, cheaperInferenceBilledCostUsd: 0.001 },
      { inputTokens: 80, outputTokens: 40, estimated: false, cheaperInferenceBilledCostUsd: 0.0007 },
    ]);
    assert.equal(inner?.syncExtractCiBilledCallCount, 2);
    assert.equal(inner?.syncExtractPhysicalCallCount, 2);

    const outer = mergeStatusWidgetExtractUsages([
      { inputTokens: 200, outputTokens: 100, estimated: false, cheaperInferenceBilledCostUsd: 0.0005 },
      inner!,
    ]);
    assert.ok(Math.abs((outer?.cheaperInferenceBilledCostUsd ?? 0) - 0.0022) < 1e-9);
    assert.equal(outer?.syncExtractCiBilledCallCount, 3);
    assert.equal(outer?.syncExtractPhysicalCallCount, 3);

    const p = resolveSyncExtractActualCost(
      [
        { cheaperInferenceBilledCostUsd: 0.0005 },
        {
          cheaperInferenceBilledCostUsd: inner!.cheaperInferenceBilledCostUsd,
          syncExtractCiBilledCallCount: inner!.syncExtractCiBilledCallCount,
          syncExtractPhysicalCallCount: inner!.syncExtractPhysicalCallCount,
        },
      ],
      LEGACY_FX_EFFECTIVE
    );
    assert.ok(Math.abs((p.actualProviderCostUsd ?? 0) - 0.0022) < 1e-9);
    assert.equal(p.billedCallCount, 3);
    assert.equal(p.physicalCallCount, 3);
    assert.equal(p.actualCostCoverage, "complete");
  });

  it("R2/N2 — nested aggregate partial", () => {
    const inner = mergeStatusWidgetExtractUsages([
      { inputTokens: 100, outputTokens: 50, estimated: false, cheaperInferenceBilledCostUsd: 0.001 },
      { inputTokens: 80, outputTokens: 40, estimated: false, upstreamCostUsd: 0.002 },
    ]);
    assert.equal(inner?.syncExtractCiBilledCallCount, 1);
    assert.equal(inner?.syncExtractPhysicalCallCount, 2);

    const p = resolveSyncExtractActualCost(
      [
        { cheaperInferenceBilledCostUsd: 0.0005 },
        {
          cheaperInferenceBilledCostUsd: inner!.cheaperInferenceBilledCostUsd,
          syncExtractCiBilledCallCount: inner!.syncExtractCiBilledCallCount,
          syncExtractPhysicalCallCount: inner!.syncExtractPhysicalCallCount,
        },
      ],
      LEGACY_FX_EFFECTIVE
    );
    assert.equal(p.physicalCallCount, 3);
    assert.equal(p.billedCallCount, 2);
    assert.equal(p.actualCostCoverage, "partial");
  });
});

describe("adminBillingReceiptV2 corrections", () => {
  it("R3/R4 — adult handoff selected != delivered main actual model", () => {
    const receipt = buildAdminBillingReceiptV2(
      baseUsage({
        model: "google/gemini-3.7-flash",
        modelLabel: "Gemini 3.7 Flash",
        provider: "openrouter",
        adultRouting: {
          activeRoute: "adult",
          actualModel: "qwen/qwen3-235b-a22b",
          actualProvider: "cheaperinference",
          userSelectedModel: "google/gemini-3.7-flash",
          userSelectedModelLabel: "Gemini 3.7 Flash",
        },
        shadowPricing: shadowFixture({
          modelId: "qwen/qwen3-235b-a22b",
          provider: "cheaperinference",
        }),
      })
    );
    assert.equal(receipt.userCharge.selectedModelLabel, "Gemini 3.7 Flash");
    assert.equal(receipt.userCharge.billingModelId, "qwen/qwen3-235b-a22b");
    assert.equal(receipt.mainRp.actual?.model, "qwen/qwen3-235b-a22b");
    assert.equal(receipt.mainRp.actual?.provider, "cheaperinference");
  });

  it("R5/R6 — user billing tokens exclude sync; aggregate telemetry separate", () => {
    const receipt = buildAdminBillingReceiptV2(
      baseUsage({
        input: 1000,
        output: 500,
        apiInputTokens: 1100,
        apiOutputTokens: 550,
        statusWidgetExtract: {
          model: OPENROUTER_GEMINI_25_FLASH_MODEL,
          modelLabel: "Gemini",
          input: 100,
          output: 50,
          apiRawCostKrw: 4,
        },
      })
    );
    assert.equal(receipt.userCharge.inputTokens, 1000);
    assert.equal(receipt.userCharge.outputTokens, 500);
    assert.equal(receipt.aggregateApiTelemetry?.inputTokens, 1100);
    assert.equal(receipt.aggregateApiTelemetry?.outputTokens, 550);
  });

  it("R7 — FX mismatch uses shadow FX for sync v2 KRW", () => {
    const receipt = buildAdminBillingReceiptV2(
      baseUsage({
        shadowPricing: shadowFixture(),
        statusWidgetExtract: {
          model: OPENROUTER_GEMINI_25_FLASH_MODEL,
          modelLabel: "Gemini",
          input: 100,
          output: 50,
          apiRawCostKrw: 4,
          actualProviderCostUsd: 0.01,
          actualProviderCostKrw: 15,
          actualCostSource: "cheaper_inference_billed",
          actualCostCoverage: "complete",
        },
      })
    );
    assert.equal(receipt.syncPlatformSpend.actualProviderCostKrw, 16);
    assert.equal(receipt.syncPlatformSpend.legacyStoredActualKrw, 15);
    assert.equal(receipt.capturedSyncProviderSpendKrw, 46);
  });

  it("R8 — card fee applied once in v2 sync KRW", () => {
    const effective = applyOverseasCardFee(1530);
    const expected = Math.round(convertUsdToKrw(0.02, effective) * 10) / 10;
    const p = resolveSyncExtractActualCostFromAggregate(
      { cheaperInferenceBilledCostUsd: 0.02, physicalCallCount: 1, billedCallCount: 1 },
      effective
    );
    assert.equal(p.actualProviderCostKrw, expected);
  });

  it("R9/R10 — clipboard uses same v2 projection without legacy actual labels", () => {
    const usage = baseUsage({ shadowPricing: shadowFixture() });
    const receipt = buildAdminBillingReceiptV2(usage);
    const text = formatAdminBillingReceiptV2Text(receipt);
    assert.match(text, /\[사용자 청구\]/);
    assert.match(text, /\[Main RP — Provider Actual\]/);
    assert.match(text, /\[플랫폼 부담 후처리\]/);
    assert.doesNotMatch(text, /API 원가 합계/);
    assert.doesNotMatch(text, /실제 API 원가/);
    assert.doesNotMatch(text, /공급자 보고 API 원가/);
  });

  it("R11 — tiny actual USD preserves non-zero display", () => {
    assert.equal(formatAdminActualUsd(0.000043), "$0.000043");
    assert.notEqual(formatAdminActualUsd(0.000043), "$0.0000");
  });

  it("R11b — USD→KRW inline label uses billing FX", () => {
    assert.equal(formatAdminKrwFromUsd(0.02, 1375.97), "≈ ₩28");
    assert.equal(formatAdminKrwFromUsd(0.5, 1375.97), "≈ ₩688");
    assert.equal(formatAdminKrwFromUsd(null, 1375.97), null);
    assert.equal(formatAdminKrwFromUsd(0.02, null), null);
    assert.equal(formatAdminKrwFromUsd(0, 1375.97), null);
  });

  it("R12 — public strips new shadow provenance fields", () => {
    const admin = baseUsage({
      shadowPricing: shadowFixture({ modelId: "qwen/qwen3", provider: "cheaperinference" }),
      statusWidgetExtract: {
        model: OPENROUTER_GEMINI_25_FLASH_MODEL,
        modelLabel: "Gemini",
        input: 100,
        output: 50,
        apiRawCostKrw: 4,
        actualProviderCostUsd: 0.001,
      },
    });
    const pub = sanitizeUsageForPublicReceipt(admin);
    assert.equal(pub.shadowPricing, undefined);
    assert.equal(pub.statusWidgetExtract, undefined);
    assert.ok(admin.shadowPricing?.modelId);
  });

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
          ...shadowFixture(),
          actualCostUsd: shadow.actualCostUsd,
          actualProviderCostKrw: shadow.actualProviderCostKrw,
          actualCostSource: shadow.actualCostSource,
        },
      })
    );
    assert.equal(receipt.mainRp.actual?.exactness, "settled");
  });

  it("T33 — missing aux is not zero", () => {
    const receipt = buildAdminBillingReceiptV2(baseUsage({ shadowPricing: shadowFixture() }));
    assert.equal(receipt.syncPlatformSpend.status, "not_persisted");
    assert.equal(receipt.capturedSyncProviderSpendKrw, null);
  });

  it("T34 — historical legacy row without shadow snapshot", () => {
    const receipt = buildAdminBillingReceiptV2(
      baseUsage({ apiRawCostKrw: 25, upstreamCostUsd: 0.015 })
    );
    assert.equal(receipt.snapshotAvailable, false);
    assert.equal(receipt.mainRp.actual, null);
    assert.match(receipt.historicalNote ?? "", /정확한 정산 스냅샷/);
  });

  it("T4 — CI billed beats upstream on widget receipt", () => {
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
      {
        mode: "daily_kst",
        dateKey: "2026-08-30",
        usdToKrw: 1530,
        effectiveKrwPerUsd: applyOverseasCardFee(1530),
        source: "api",
      },
      { modelId: OPENROUTER_GEMINI_25_FLASH_MODEL, callCount: 1, postTurnSharedInitial: true }
    );
    assert.equal(receipt.actualProviderCostUsd, 0.01);
  });

  it("catalog estimate is not settled label", () => {
    const receipt = buildAdminBillingReceiptV2(
      baseUsage({
        shadowPricing: shadowFixture({ actualCostSource: "live_catalog_estimated" }),
      })
    );
    assert.notEqual(adminReceiptExactnessLabel(receipt.mainRp.actual!.exactness), "정산 확정");
  });

  it("F4 — CI billed complete is settled with margin", () => {
    const receipt = buildAdminBillingReceiptV2(
      baseUsage({
        cost: 80,
        shadowPricing: shadowFixture({
          provider: "cheaperinference",
          actualCostSource: "cheaper_inference_billed",
          actualTurnCostCoverage: "complete",
          actualProviderCostKrw: 30,
        }),
      })
    );
    assert.equal(receipt.mainRp.actual?.exactness, "settled");
    assert.equal(receipt.mainRp.marginPercent, 63);
  });

  it("F5 — CI provider_reported only is not settled", () => {
    const receipt = buildAdminBillingReceiptV2(
      baseUsage({
        cost: 80,
        shadowPricing: shadowFixture({
          provider: "cheaperinference",
          actualCostSource: "provider_reported",
          actualTurnCostCoverage: "complete",
          actualProviderCostKrw: 30,
        }),
      })
    );
    assert.notEqual(receipt.mainRp.actual?.exactness, "settled");
    assert.equal(receipt.mainRp.actual?.exactness, "estimated");
    assert.equal(receipt.mainRp.marginPercent, null);
    assert.notEqual(adminReceiptExactnessLabel(receipt.mainRp.actual!.exactness), "정산 확정");
    const text = formatAdminBillingReceiptV2Text(receipt);
    assert.doesNotMatch(text, /정산 확정/);
  });

  it("F6 — CI billed beats upstream conflict remains settled", () => {
    const receipt = buildAdminBillingReceiptV2(
      baseUsage({
        shadowPricing: shadowFixture({
          provider: "cheaperinference",
          actualCostSource: "cheaper_inference_billed",
          actualCostUsd: 0.01,
          actualTurnCostCoverage: "complete",
        }),
      })
    );
    assert.equal(receipt.mainRp.actual?.actualProviderCostUsd, 0.01);
    assert.equal(receipt.mainRp.actual?.exactness, "settled");
  });

  it("F7 — OpenRouter provider_reported complete remains settled", () => {
    const receipt = buildAdminBillingReceiptV2(
      baseUsage({
        provider: "openrouter",
        shadowPricing: shadowFixture({
          provider: "openrouter",
          actualCostSource: "provider_reported",
          actualTurnCostCoverage: "complete",
        }),
      })
    );
    assert.equal(receipt.mainRp.actual?.exactness, "settled");
  });
});

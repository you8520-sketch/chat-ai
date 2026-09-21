import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import { buildAdminBillingReceiptV2 } from "@/lib/adminBillingReceiptV2";
import { buildAdminBillingForensicMetadata } from "@/lib/adminBillingForensicMetadata";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import type { Usage } from "@/lib/chatUsage";
import {
  classifyCiCurrentChange,
  classifyCiReferenceChange,
  classifySourceConflict,
} from "@/lib/modelPriceChangeClassifier";
import {
  buildCiCurrentSnapshot,
  buildCiReferenceSnapshot,
  buildPublishedBaselineSnapshot,
  type ModelPriceSnapshotRecord,
} from "@/lib/modelPriceSnapshot";
import { getModelPricingPolicy } from "@/lib/modelPricingPolicy";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import type { PublishedModelPricing } from "@/lib/publishedModelPricing";
import { canonicalizePublishedModelId } from "@/lib/publishedModelAliases";
import {
  computePublishedUserChargeFromResolvedPolicy,
  computePublishedUserChargeWithSnapshot,
  isLiveGradePublishedUserChargeSnapshot,
} from "@/lib/publishedUserCharge";

/** Deterministic regression FX only — not runtime FX owner. */
const FX_DETERMINISTIC: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-08-28",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

/** Competitor observed charge for the golden comparable turn (external benchmark). */
const COMPETITOR_GOLDEN_BENCHMARK_P = 105;

/** Official DeepSeek V4 Pro OFF-PEAK (historical v2 published baseline). */
const OFFICIAL_OFF_PEAK = {
  input: 0.66,
  output: 1.98,
  cacheRead: 0.022,
} as const;

/** Official DeepSeek V4 Pro PEAK (v3 stable reference cost owner). */
const OFFICIAL_PEAK = {
  input: 1.32,
  output: 3.96,
  cacheRead: 0.044,
} as const;

/** Immutable v2 pricing embedded in historical receipt snapshots — test-local only. */
const V2_HISTORICAL_PRICING: PublishedModelPricing = {
  modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  billingReferenceInputUsdPerMillion: OFFICIAL_OFF_PEAK.input,
  billingReferenceOutputUsdPerMillion: OFFICIAL_OFF_PEAK.output,
  billingReferenceCacheReadUsdPerMillion: OFFICIAL_OFF_PEAK.cacheRead,
  targetMargin: 0.5,
  minimumMarginFloor: 0.4,
  pricingVersion: 2,
  publishedAt: "2026-09-02T09:00:00.000Z",
};

/** #997 pre-competitive candidate: PEAK reference + 50% margin → golden 180P. */
const V3_PEAK_FIFTY_MARGIN_PRICING: PublishedModelPricing = {
  modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  billingReferenceInputUsdPerMillion: OFFICIAL_PEAK.input,
  billingReferenceOutputUsdPerMillion: OFFICIAL_PEAK.output,
  billingReferenceCacheReadUsdPerMillion: OFFICIAL_PEAK.cacheRead,
  targetMargin: 0.5,
  minimumMarginFloor: 0.4,
  pricingVersion: 3,
  publishedAt: "2026-09-21T09:00:00.000Z",
};

const GOLDEN_USAGE = {
  promptTokens: 33_247,
  outputTokens: 3_461,
  cacheReadTokens: 0,
} as const;

const MATRIX_FIXTURES = [
  { id: "A", promptTokens: 10_000, outputTokens: 500, cacheReadTokens: 0, v2P: 24, peak50P: 48, competitiveP: 27 },
  { id: "B", promptTokens: 30_000, outputTokens: 3_000, cacheReadTokens: 0, v2P: 81, peak50P: 161, competitiveP: 90 },
  { id: "C", promptTokens: 35_000, outputTokens: 4_000, cacheReadTokens: 0, v2P: 97, peak50P: 194, competitiveP: 108 },
  { id: "D", promptTokens: 12_871, outputTokens: 1_273, cacheReadTokens: 12_800, v2P: 9, peak50P: 18, competitiveP: 10 },
  { id: "E", promptTokens: 33_247, outputTokens: 3_461, cacheReadTokens: 0, v2P: 90, peak50P: 180, competitiveP: 100 },
  { id: "F", promptTokens: 8_000, outputTokens: 1_500, cacheReadTokens: 0, v2P: 26, peak50P: 52, competitiveP: 29 },
] as const;

function usageFromFixture(fixture: (typeof MATRIX_FIXTURES)[number]) {
  return normalizeBillableUsage({
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    promptTokens: fixture.promptTokens,
    outputTokens: fixture.outputTokens,
    cacheReadTokens: fixture.cacheReadTokens,
  });
}

function chargeFromPricing(pricing: PublishedModelPricing, usage: ReturnType<typeof normalizeBillableUsage>) {
  return computePublishedUserChargeFromResolvedPolicy({
    requestedModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    resolvedPricing: {
      requestedModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      canonicalModelId: canonicalizePublishedModelId(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
      pricing,
    },
    usage,
    usageCoverage: "complete",
    fxSnapshot: FX_DETERMINISTIC,
    adjustment: { kind: "none" },
    expectedCanonicalModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  });
}

function chargeLive(usage: ReturnType<typeof normalizeBillableUsage>) {
  return computePublishedUserChargeWithSnapshot({
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    usage,
    usageCoverage: "complete",
    fxSnapshot: FX_DETERMINISTIC,
    adjustment: { kind: "none" },
  });
}

describe("deepseekV4ProCompetitivePricingV4 — RED off-peak baseline proof", () => {
  it("v2 historical row matched official OFF-PEAK exactly (V4_PRO_STABLE_BASELINE_USES_OFF_PEAK)", () => {
    assert.equal(V2_HISTORICAL_PRICING.billingReferenceInputUsdPerMillion, OFFICIAL_OFF_PEAK.input);
    assert.equal(V2_HISTORICAL_PRICING.billingReferenceOutputUsdPerMillion, OFFICIAL_OFF_PEAK.output);
    assert.equal(V2_HISTORICAL_PRICING.billingReferenceCacheReadUsdPerMillion, OFFICIAL_OFF_PEAK.cacheRead);
    assert.equal(OFFICIAL_OFF_PEAK.input * 2, OFFICIAL_PEAK.input);
    assert.equal(OFFICIAL_OFF_PEAK.output * 2, OFFICIAL_PEAK.output);
    assert.equal(OFFICIAL_OFF_PEAK.cacheRead * 2, OFFICIAL_PEAK.cacheRead);
  });
});

describe("deepseekV4ProCompetitivePricingV4 — competitive v4 PEAK reference row", () => {
  it("live catalog keeps official PEAK reference with engine-calibrated margin", () => {
    const pricing = getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(pricing.pricingVersion, 4);
    assert.equal(pricing.billingReferenceInputUsdPerMillion, OFFICIAL_PEAK.input);
    assert.equal(pricing.billingReferenceOutputUsdPerMillion, OFFICIAL_PEAK.output);
    assert.equal(pricing.billingReferenceCacheReadUsdPerMillion, OFFICIAL_PEAK.cacheRead);
    assert.equal(pricing.targetMargin, 0.1);
    assert.equal(pricing.minimumMarginFloor, 0);
    assert.equal(pricing.publishedAt, "2026-09-21T12:57:00.000Z");
  });
});

describe("deepseekV4ProCompetitivePricingV4 — golden 180P formula reproduction", () => {
  it("PEAK reference + 50% margin reproduces 180P on golden fixture", () => {
    const usage = normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      ...GOLDEN_USAGE,
    });
    const result = chargeFromPricing(V3_PEAK_FIFTY_MARGIN_PRICING, usage);
    assert.equal(result.status, "complete");
    if (result.status !== "complete") return;
    assert.equal(result.snapshot.billingReferenceCostUsd, 0.0575916);
    assert.equal(result.snapshot.billingReferenceCostKrw, 89.9);
    assert.equal(result.snapshot.standardUserChargeKrw, 179.8);
    assert.equal(result.snapshot.finalPoints, 180);
  });
});

describe("deepseekV4ProCompetitivePricingV4 — competitive variable P matrix", () => {
  for (const fixture of MATRIX_FIXTURES) {
    it(`${fixture.id}: v2=${fixture.v2P} peak50=${fixture.peak50P} competitive=${fixture.competitiveP}`, () => {
      const usage = usageFromFixture(fixture);
      const v2 = chargeFromPricing(V2_HISTORICAL_PRICING, usage);
      const peak50 = chargeFromPricing(V3_PEAK_FIFTY_MARGIN_PRICING, usage);
      const competitive = chargeLive(usage);
      assert.equal(v2.status, "complete");
      assert.equal(peak50.status, "complete");
      assert.equal(competitive.status, "complete");
      if (v2.status !== "complete" || peak50.status !== "complete" || competitive.status !== "complete") {
        return;
      }
      assert.equal(v2.snapshot.finalPoints, fixture.v2P);
      assert.equal(peak50.snapshot.finalPoints, fixture.peak50P);
      assert.equal(competitive.snapshot.finalPoints, fixture.competitiveP);
      assert.ok(Math.abs(competitive.snapshot.billingReferenceCostUsd - v2.snapshot.billingReferenceCostUsd * 2) < 1e-9);
    });
  }

  it("E golden fixture is exactly 100P calibration target", () => {
    const result = chargeLive(
      normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        ...GOLDEN_USAGE,
      })
    );
    assert.equal(result.status, "complete");
    if (result.status === "complete") {
      assert.equal(result.snapshot.finalPoints, 100);
      assert.equal(result.snapshot.billingReferenceCostKrw, 89.9);
    }
  });
});

describe("deepseekV4ProCompetitivePricingV4 — variable-price invariants", () => {
  it("shorter usage charges less than golden 100P", () => {
    const short = chargeLive(
      normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        promptTokens: 10_000,
        outputTokens: 500,
      })
    );
    const golden = chargeLive(
      normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        ...GOLDEN_USAGE,
      })
    );
    assert.equal(short.status, "complete");
    assert.equal(golden.status, "complete");
    if (short.status === "complete" && golden.status === "complete") {
      assert.ok(short.snapshot.finalPoints < golden.snapshot.finalPoints);
      assert.notEqual(golden.snapshot.finalPoints, short.snapshot.finalPoints);
    }
  });

  it("larger usage charges more than golden 100P", () => {
    const large = chargeLive(
      normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        promptTokens: 35_000,
        outputTokens: 4_000,
      })
    );
    const golden = chargeLive(
      normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        ...GOLDEN_USAGE,
      })
    );
    assert.equal(large.status, "complete");
    assert.equal(golden.status, "complete");
    if (large.status === "complete" && golden.status === "complete") {
      assert.ok(large.snapshot.finalPoints > golden.snapshot.finalPoints);
    }
  });

  it("more cache read lowers charge for same prompt/output", () => {
    const noCache = chargeLive(
      normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        promptTokens: 12_871,
        outputTokens: 1_273,
        cacheReadTokens: 0,
      })
    );
    const cacheHit = chargeLive(
      normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        promptTokens: 12_871,
        outputTokens: 1_273,
        cacheReadTokens: 12_800,
      })
    );
    assert.equal(noCache.status, "complete");
    assert.equal(cacheHit.status, "complete");
    if (noCache.status === "complete" && cacheHit.status === "complete") {
      assert.ok(cacheHit.snapshot.finalPoints < noCache.snapshot.finalPoints);
    }
  });

  it("zero output is not forced to golden 100P", () => {
    const tiny = chargeLive(
      normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        promptTokens: 5_000,
        outputTokens: 0,
      })
    );
    assert.equal(tiny.status, "complete");
    if (tiny.status === "complete") {
      assert.ok(tiny.snapshot.finalPoints < 100);
      assert.ok(Number.isInteger(tiny.snapshot.finalPoints));
    }
  });
});

describe("deepseekV4ProCompetitivePricingV4 — competitor benchmark report", () => {
  it("golden 100P vs competitor benchmark 105P", () => {
    const golden = chargeLive(
      normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        ...GOLDEN_USAGE,
      })
    );
    assert.equal(golden.status, "complete");
    if (golden.status === "complete") {
      assert.equal(golden.snapshot.finalPoints, 100);
      const delta = golden.snapshot.finalPoints - COMPETITOR_GOLDEN_BENCHMARK_P;
      const pct = (delta / COMPETITOR_GOLDEN_BENCHMARK_P) * 100;
      assert.equal(delta, -5);
      assert.ok(Math.abs(pct - (-4.76)) < 0.1);
    }
  });
});

describe("deepseekV4ProCompetitivePricingV4 — historical v2 receipt consumer path", () => {
  it("stored v2 shadowPricing admin receipt stays 90P with v2 rates under live v4 catalog", () => {
    const historicalCharge = chargeFromPricing(
      V2_HISTORICAL_PRICING,
      normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        ...GOLDEN_USAGE,
      })
    );
    assert.equal(historicalCharge.status, "complete");
    if (historicalCharge.status !== "complete") return;

    const liveCatalog = getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(liveCatalog.pricingVersion, 4);
    assert.equal(liveCatalog.targetMargin, 0.1);

    const storedUsage: Usage = {
      input: GOLDEN_USAGE.promptTokens,
      output: GOLDEN_USAGE.outputTokens,
      model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      selectedAI: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      provider: "cheaperinference",
      route: "safe",
      cost: 90,
      breakdown: [],
      billingContractDispatch: {
        billingContract: "published_phase2",
        billingContractReason: "phase2_deepseek_live_grade",
        deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        publishedCandidateStatus: "resolved",
        publishedBlockReason: null,
        pricingVersion: 2,
        publishedFinalPoints: 90,
        legacyFinalPoints: 95,
        settledDeductedPoints: 90,
      },
      shadowPricing: {
        pricingVersion: 2,
        billingReferenceInputUsdPerMillion: 0.66,
        billingReferenceOutputUsdPerMillion: 1.98,
        billingReferenceCostKrw: historicalCharge.snapshot.billingReferenceCostKrw,
        billingReferenceCostUsd: historicalCharge.snapshot.billingReferenceCostUsd,
        fxSnapshot: {
          dateKey: FX_DETERMINISTIC.dateKey,
          source: FX_DETERMINISTIC.source,
          baseUsdKrw: FX_DETERMINISTIC.usdToKrw,
          overseasFeeRate: FX_DETERMINISTIC.overseasFeeRate,
          effectiveKrwPerUsd: FX_DETERMINISTIC.effectiveKrwPerUsd,
        },
        providerListCostStatus: "complete",
        reserveStatus: "complete",
        actualProviderCostKrw: 45,
        actualCostSource: "cheaper_inference_billed",
        providerListCostKrw: 50,
        inputCostKrw: 20,
        outputCostKrw: 20,
        reasoningCostKrw: 0,
        cacheReadCostKrw: 0,
        cacheWriteCostKrw: 0,
        targetMargin: 0.5,
        minimumMarginFloor: 0.4,
        standardUserChargeKrw: historicalCharge.snapshot.standardUserChargeKrw,
        promoPercent: 0,
        finalShadowChargeKrw: 90,
        finalShadowPoints: 90,
        providerSavingsKrw: null,
        providerOverrunKrw: null,
        promoGivebackKrw: 0,
        netPricingBufferDeltaKrw: null,
        actualGrossProfitKrw: 45,
        actualRealizedMargin: 0.5,
        worstCasePromoMargin: null,
        marginFloorViolated: null,
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        provider: "cheaperinference",
      },
    };

    const receipt = buildAdminBillingReceiptV2(storedUsage);
    assert.equal(receipt.userCharge.deductedPoints, 90);
    assert.equal(receipt.userCharge.publishedFinalPoints, 90);
    assert.equal(receipt.userCharge.pricingVersion, 2);
    assert.equal(receipt.mainRp.publishedPricing?.pricingVersion, 2);
    assert.equal(receipt.mainRp.publishedPricing?.billingReferenceInputUsdPerMillion, 0.66);
    assert.equal(receipt.mainRp.publishedPricing?.billingReferenceOutputUsdPerMillion, 1.98);

    const forensic = buildAdminBillingForensicMetadata({
      assistantMessageId: 1,
      chatId: 1,
      requestId: "historical-v2-golden",
      usage: storedUsage,
      deductionSlicesRaw: JSON.stringify([{ pointType: "PAID", amount: 90, transactionId: 1 }]),
    });
    assert.equal(forensic.pricingVersion, 2);
    assert.equal(forensic.publishedFinalPoints, 90);
    assert.equal(forensic.finalChargeConsistency?.consistent, true);
  });

  it("stored v3 shadowPricing admin receipt stays 180P with v3 PEAK+50% policy under live v4 catalog", () => {
    const historicalV3 = chargeFromPricing(
      V3_PEAK_FIFTY_MARGIN_PRICING,
      normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        ...GOLDEN_USAGE,
      })
    );
    assert.equal(historicalV3.status, "complete");
    if (historicalV3.status !== "complete") return;

    const liveCatalog = getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(liveCatalog.pricingVersion, 4);
    assert.equal(liveCatalog.targetMargin, 0.1);

    const storedUsage: Usage = {
      input: GOLDEN_USAGE.promptTokens,
      output: GOLDEN_USAGE.outputTokens,
      model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      selectedAI: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      provider: "cheaperinference",
      route: "safe",
      cost: 180,
      breakdown: [],
      billingContractDispatch: {
        billingContract: "published_phase2",
        billingContractReason: "phase2_deepseek_live_grade",
        deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        publishedCandidateStatus: "resolved",
        publishedBlockReason: null,
        pricingVersion: 3,
        publishedFinalPoints: 180,
        legacyFinalPoints: 95,
        settledDeductedPoints: 180,
      },
      shadowPricing: {
        pricingVersion: 3,
        billingReferenceInputUsdPerMillion: OFFICIAL_PEAK.input,
        billingReferenceOutputUsdPerMillion: OFFICIAL_PEAK.output,
        billingReferenceCostKrw: historicalV3.snapshot.billingReferenceCostKrw,
        billingReferenceCostUsd: historicalV3.snapshot.billingReferenceCostUsd,
        fxSnapshot: {
          dateKey: FX_DETERMINISTIC.dateKey,
          source: FX_DETERMINISTIC.source,
          baseUsdKrw: FX_DETERMINISTIC.usdToKrw,
          overseasFeeRate: FX_DETERMINISTIC.overseasFeeRate,
          effectiveKrwPerUsd: FX_DETERMINISTIC.effectiveKrwPerUsd,
        },
        providerListCostStatus: "complete",
        reserveStatus: "complete",
        actualProviderCostKrw: 90,
        actualCostSource: "cheaper_inference_billed",
        providerListCostKrw: 90,
        inputCostKrw: 45,
        outputCostKrw: 45,
        reasoningCostKrw: 0,
        cacheReadCostKrw: 0,
        cacheWriteCostKrw: 0,
        targetMargin: 0.5,
        minimumMarginFloor: 0.4,
        standardUserChargeKrw: historicalV3.snapshot.standardUserChargeKrw,
        promoPercent: 0,
        finalShadowChargeKrw: 180,
        finalShadowPoints: 180,
        providerSavingsKrw: null,
        providerOverrunKrw: null,
        promoGivebackKrw: 0,
        netPricingBufferDeltaKrw: null,
        actualGrossProfitKrw: 90,
        actualRealizedMargin: 0.5,
        worstCasePromoMargin: null,
        marginFloorViolated: null,
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        provider: "cheaperinference",
      },
    };

    const receipt = buildAdminBillingReceiptV2(storedUsage);
    assert.equal(receipt.userCharge.deductedPoints, 180);
    assert.equal(receipt.userCharge.publishedFinalPoints, 180);
    assert.equal(receipt.userCharge.pricingVersion, 3);
    assert.equal(receipt.mainRp.publishedPricing?.pricingVersion, 3);
    assert.equal(receipt.mainRp.publishedPricing?.billingReferenceInputUsdPerMillion, OFFICIAL_PEAK.input);
    assert.equal(receipt.mainRp.publishedPricing?.billingReferenceOutputUsdPerMillion, OFFICIAL_PEAK.output);

    const forensic = buildAdminBillingForensicMetadata({
      assistantMessageId: 2,
      chatId: 1,
      requestId: "historical-v3-golden",
      usage: storedUsage,
      deductionSlicesRaw: JSON.stringify([{ pointType: "PAID", amount: 180, transactionId: 2 }]),
    });
    assert.equal(forensic.pricingVersion, 3);
    assert.equal(forensic.publishedFinalPoints, 180);
    assert.equal(forensic.finalChargeConsistency?.consistent, true);
  });

  it("v2 embedded snapshot replay keeps pricingVersion=2 and original charged P", () => {
    const usage = normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      ...GOLDEN_USAGE,
    });
    const historical = chargeFromPricing(V2_HISTORICAL_PRICING, usage);
    const live = chargeLive(usage);
    assert.equal(historical.status, "complete");
    assert.equal(live.status, "complete");
    if (historical.status === "complete") {
      assert.equal(historical.snapshot.pricingVersion, 2);
      assert.equal(historical.snapshot.finalPoints, 90);
      assert.equal(isLiveGradePublishedUserChargeSnapshot(historical.snapshot), false);
      assert.notEqual(historical.snapshot.finalPoints, live.status === "complete" ? live.snapshot.finalPoints : null);
    }
  });
});

describe("deepseekV4ProCompetitivePricingV4 — tracker semantic-domain matrix T1-T4", () => {
  const observedAt = "2026-09-21T09:00:00.000Z";
  const runDateKey = "2026-09-21";
  const policy = getModelPricingPolicy(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL)!;
  const published = getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);

  function deepSeekReferenceSnapshot(
    reference: Partial<{
      input: number;
      output: number;
      cacheRead: number;
    }>
  ): ModelPriceSnapshotRecord {
    return buildCiReferenceSnapshot({
      policy,
      catalog: {
        modelId: policy.expectedProviderModelId,
        inputUsdPerMillion: 0.33,
        outputUsdPerMillion: 0.99,
        cacheReadUsdPerMillion: 0.033,
        cacheWriteUsdPerMillion: 0.33,
        referenceInputUsdPerMillion: reference.input ?? OFFICIAL_OFF_PEAK.input,
        referenceOutputUsdPerMillion: reference.output ?? OFFICIAL_OFF_PEAK.output,
        referenceCacheReadUsdPerMillion: reference.cacheRead ?? OFFICIAL_OFF_PEAK.cacheRead,
      },
      observedAt,
    })!;
  }

  it("T1: published PEAK vs CI procurement_reference OFF-PEAK → no SOURCE_CONFLICT", () => {
    const publishedBaseline = buildPublishedBaselineSnapshot({ policy, published, observedAt });
    const ciReference = deepSeekReferenceSnapshot({});
    assert.equal(publishedBaseline.rates.inputUsdPerMillion, OFFICIAL_PEAK.input);
    assert.equal(ciReference.rates.inputUsdPerMillion, OFFICIAL_OFF_PEAK.input);
    const conflict = classifySourceConflict({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      ciReference,
      publishedBaseline,
      runDateKey,
    });
    assert.equal(conflict, null);
  });

  it("T2: CI reference 0.66/1.98 → 0.70/2.10 → CI_REFERENCE_CHANGED_UNVERIFIED/HOLD", () => {
    const prev = deepSeekReferenceSnapshot({});
    const next = deepSeekReferenceSnapshot({ input: 0.7, output: 2.1, cacheRead: 0.023 });
    const events = classifyCiReferenceChange({
      policy,
      published,
      previous: prev,
      current: next,
    });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.eventType, "CI_REFERENCE_CHANGED_UNVERIFIED");
    assert.equal(events[0]?.action, "HOLD");
    assert.equal(events[0]?.classification, "ci_reference_changed_unverified");
  });

  it("T2b: CI reference converges to published PEAK numerically still emits HOLD", () => {
    const prev = deepSeekReferenceSnapshot({});
    const next = deepSeekReferenceSnapshot({
      input: OFFICIAL_PEAK.input,
      output: OFFICIAL_PEAK.output,
      cacheRead: OFFICIAL_PEAK.cacheRead,
    });
    const events = classifyCiReferenceChange({
      policy,
      published,
      previous: prev,
      current: next,
    });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.eventType, "CI_REFERENCE_CHANGED_UNVERIFIED");
    assert.equal(events[0]?.action, "HOLD");
  });

  it("T2c: cache-only CI reference change remains observable", () => {
    const prev = deepSeekReferenceSnapshot({
      input: OFFICIAL_OFF_PEAK.input,
      output: OFFICIAL_OFF_PEAK.output,
      cacheRead: 0.02,
    });
    const next = deepSeekReferenceSnapshot({
      input: OFFICIAL_OFF_PEAK.input,
      output: OFFICIAL_OFF_PEAK.output,
      cacheRead: 0.025,
    });
    const events = classifyCiReferenceChange({
      policy,
      published,
      previous: prev,
      current: next,
    });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.eventType, "CI_REFERENCE_CHANGED_UNVERIFIED");
  });

  it("T3: CI current procurement changes → PROCUREMENT_ONLY event", () => {
    const prev = buildCiCurrentSnapshot({
      policy,
      catalog: {
        modelId: policy.expectedProviderModelId,
        inputUsdPerMillion: 0.5,
        outputUsdPerMillion: 1.5,
        cacheReadUsdPerMillion: 0.05,
        cacheWriteUsdPerMillion: 0.5,
        referenceInputUsdPerMillion: OFFICIAL_OFF_PEAK.input,
        referenceOutputUsdPerMillion: OFFICIAL_OFF_PEAK.output,
        discountPercent: 25,
      },
      observedAt,
    });
    const next = buildCiCurrentSnapshot({
      policy,
      catalog: {
        modelId: policy.expectedProviderModelId,
        inputUsdPerMillion: 0.3,
        outputUsdPerMillion: 0.9,
        cacheReadUsdPerMillion: 0.03,
        cacheWriteUsdPerMillion: 0.3,
        referenceInputUsdPerMillion: OFFICIAL_OFF_PEAK.input,
        referenceOutputUsdPerMillion: OFFICIAL_OFF_PEAK.output,
        discountPercent: 55,
      },
      observedAt,
    });
    const events = classifyCiCurrentChange({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      previous: prev,
      current: next,
    });
    assert.ok(events.some((e) => e.action === "PROCUREMENT_ONLY"));
  });

  it("T4: mocked official PEAK vs published PEAK stays dormant until Phase B adapter wires comparable domains", () => {
    const publishedBaseline = buildPublishedBaselineSnapshot({ policy, published, observedAt });
    const mockOfficialPeak: ModelPriceSnapshotRecord = {
      ...publishedBaseline,
      pricingMode: "provider_peak",
      sourceKind: "cheaper_inference_models_reference",
      rates: {
        inputUsdPerMillion: 1.4,
        outputUsdPerMillion: 4.2,
        cacheReadUsdPerMillion: 0.04,
        cacheWriteUsdPerMillion: null,
        tierThreshold: null,
        discountPercent: null,
      },
      rawFingerprint: "mock-official-peak-mismatch",
    };
    const conflict = classifySourceConflict({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      ciReference: mockOfficialPeak,
      publishedBaseline,
      runDateKey,
    });
    assert.equal(conflict, null);
  });
});

/**
 * BUGFIX PRE-FLIGHT — price matrix generator (diagnostic only, no live billing change).
 * Run: npx tsx scripts/billing-preflight-price-matrix.ts
 */
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
} from "@/lib/chatModels";
import {
  clearCheaperInferenceCatalogPricingForTest,
  updateCheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";
import { normalizeBillableUsage, type NormalizedBillableUsage } from "@/lib/billingUsage";
import { computeOpenRouterTurnBilling } from "@/lib/points";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_GROSS_MARGIN,
  CHEAPER_INFERENCE_GEMINI_31_PRO_GROSS_MARGIN,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_GROSS_MARGIN,
  CHEAPER_INFERENCE_GPT_56_TERRA_GROSS_MARGIN,
} from "@/lib/pointsReasoningMargins";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import { computePublishedUserChargeWithSnapshot } from "@/lib/publishedUserCharge";
import { resolveProcurementCostFromCatalog } from "@/lib/procurementCost";
import { getMarketBenchmarks } from "@/lib/marketUsageBenchmarks";
import { GEMINI37_CALIBRATION_RATE_EVIDENCE } from "@/lib/gemini37CalibrationEvidence";
import {
  GEMINI31_CI_OBSERVED_DISCOUNT_EVIDENCE,
  GEMINI31_OFFICIAL_BASE_TIER_EVIDENCE,
} from "@/lib/premiumPricingCalibrationEvidence";

const FX = 1530;
const EFFECTIVE_FX = Math.round(FX * 1.02 * 1000) / 1000;
const FX_SNAPSHOT = {
  mode: "daily_kst" as const,
  dateKey: "2026-09-20",
  usdToKrw: FX,
  effectiveKrwPerUsd: EFFECTIVE_FX,
  source: "api_daily" as const,
  overseasFeeRate: 0.02,
  locked: true,
};

type Shape = "NORMAL" | "MEMORY_HEAVY" | "BOUNDED_VALID_STRESS";

const USAGE_SHAPES: Record<
  string,
  Record<Shape, NormalizedBillableUsage>
> = {
  [CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL]: {
    NORMAL: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      promptTokens: 15_233,
      outputTokens: 2_070,
      reasoningTokens: 0,
    }),
    MEMORY_HEAVY: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      promptTokens: 40_689,
      outputTokens: 4_307,
      reasoningTokens: 0,
    }),
    BOUNDED_VALID_STRESS: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      promptTokens: 199_000,
      outputTokens: 3_000,
      reasoningTokens: 0,
    }),
  },
  [CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL]: {
    NORMAL: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      promptTokens: 24_952,
      outputTokens: 2_367,
      reasoningTokens: 0,
    }),
    MEMORY_HEAVY: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      promptTokens: 26_038,
      outputTokens: 2_662,
      cacheReadTokens: 20_426,
      reasoningTokens: 0,
    }),
    BOUNDED_VALID_STRESS: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      promptTokens: 42_195,
      outputTokens: 3_862,
      reasoningTokens: 0,
    }),
  },
  [CHEAPER_INFERENCE_GPT_56_TERRA_MODEL]: {
    NORMAL: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      promptTokens: 12_000,
      outputTokens: 900,
      reasoningTokens: 0,
    }),
    MEMORY_HEAVY: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      promptTokens: 35_000,
      outputTokens: 2_500,
      reasoningTokens: 0,
    }),
    BOUNDED_VALID_STRESS: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      promptTokens: 55_000,
      outputTokens: 4_000,
      reasoningTokens: 0,
    }),
  },
  [CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL]: {
    NORMAL: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      promptTokens: 33_247,
      outputTokens: 3_461,
      reasoningTokens: 0,
    }),
    MEMORY_HEAVY: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      promptTokens: 12_871,
      outputTokens: 1_273,
      cacheReadTokens: 12_800,
      reasoningTokens: 0,
    }),
    BOUNDED_VALID_STRESS: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      promptTokens: 80_000,
      outputTokens: 5_000,
      reasoningTokens: 0,
    }),
  },
};

const LIVE_MARGINS: Record<string, number> = {
  [CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL]: CHEAPER_INFERENCE_GEMINI_31_PRO_GROSS_MARGIN,
  [CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL]: CHEAPER_INFERENCE_GEMINI_37_FLASH_GROSS_MARGIN,
  [CHEAPER_INFERENCE_GPT_56_TERRA_MODEL]: CHEAPER_INFERENCE_GPT_56_TERRA_GROSS_MARGIN,
  [CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL]: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_GROSS_MARGIN,
};

const CI_FIXTURE = {
  referenceIn: 2,
  referenceOut: 12,
  currentIn: 1.4,
  currentOut: 8.4,
  discountPercent: 30,
};

function seedCatalog(modelId: string): void {
  updateCheaperInferenceCatalogPricing({
    modelId,
    inputUsdPerMillion: CI_FIXTURE.currentIn,
    cacheReadUsdPerMillion: CI_FIXTURE.currentIn * 0.25,
    cacheWriteUsdPerMillion: CI_FIXTURE.currentIn,
    outputUsdPerMillion: CI_FIXTURE.currentOut,
    referenceInputUsdPerMillion: CI_FIXTURE.referenceIn,
    referenceOutputUsdPerMillion: CI_FIXTURE.referenceOut,
    discountPercent: CI_FIXTURE.discountPercent,
    fetchedAt: Date.now(),
  });
}

function liveBaseP(modelId: string, usage: NormalizedBillableUsage): number {
  return computeOpenRouterTurnBilling({
    modelId,
    inputTokens: usage.promptTokens,
    outputTokens: usage.billableOutputTokens,
    apiPromptTokens: usage.promptTokens,
    apiCompletionTokens: usage.billableOutputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  }).baseCost;
}

function candidateBaseP(
  modelId: string,
  usage: NormalizedBillableUsage
): { points: number | null; status: string; reason?: string } {
  const result = computePublishedUserChargeWithSnapshot({
    modelId,
    usage,
    usageCoverage: "complete",
    fxSnapshot: FX_SNAPSHOT,
    adjustment: { kind: "none" },
  });
  if (result.status === "complete") {
    return { points: result.snapshot.finalPoints, status: "complete" };
  }
  return { points: null, status: "blocked", reason: result.reason };
}

function main(): void {
  clearCheaperInferenceCatalogPricingForTest();

  const models = [
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  ];

  const policyMatrix = models.map((modelId) => {
    const published = getPublishedPricing(modelId);
    const benchmarks = getMarketBenchmarks(published.modelId);
    return {
      model: modelId,
      ciReferenceInput: CI_FIXTURE.referenceIn,
      ciReferenceOutput: CI_FIXTURE.referenceOut,
      publishedReferenceInput: published.billingReferenceInputUsdPerMillion,
      publishedReferenceOutput: published.billingReferenceOutputUsdPerMillion,
      publishedTargetMargin: published.targetMargin,
      minimumMarginFloor: published.minimumMarginFloor,
      pricingVersion: published.pricingVersion,
      publishedAt: published.publishedAt,
      marketBenchmarkPoints: published.marketBenchmark?.points ?? benchmarks[0]?.competitorChargePoints ?? null,
      marketBenchmarkSource:
        published.marketBenchmark != null
          ? "publishedModelPricing.marketBenchmark"
          : benchmarks[0]?.sourceLabel ?? null,
      liveGrossMargin: LIVE_MARGINS[modelId],
      ciCurrentInput: CI_FIXTURE.currentIn,
      ciCurrentOutput: CI_FIXTURE.currentOut,
      ciDiscountPercent: CI_FIXTURE.discountPercent,
    };
  });

  const priceMatrix: unknown[] = [];
  for (const modelId of models) {
    seedCatalog(modelId);
    for (const shape of ["NORMAL", "MEMORY_HEAVY", "BOUNDED_VALID_STRESS"] as Shape[]) {
      const usage = USAGE_SHAPES[modelId][shape];
      const liveP = liveBaseP(modelId, usage);
      const candidate = candidateBaseP(modelId, usage);
      const proc = resolveProcurementCostFromCatalog({
        modelId,
        promptTokens: usage.promptTokens,
        outputTokens: usage.billableOutputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        effectiveKrwPerUsd: FX,
      });
      const published = getPublishedPricing(modelId);
      const refUsd =
        (usage.standardInputTokens / 1_000_000) * published.billingReferenceInputUsdPerMillion +
        (usage.cacheReadTokens / 1_000_000) *
          (published.billingReferenceCacheReadUsdPerMillion ?? 0) +
        (usage.cacheWriteTokens / 1_000_000) *
          (published.billingReferenceCacheWriteUsdPerMillion ?? 0) +
        (usage.billableOutputTokens / 1_000_000) * published.billingReferenceOutputUsdPerMillion;
      const refKrw = refUsd * EFFECTIVE_FX;
      const procKrw = (proc?.procurementCostKrw ?? 0);
      const realized =
        liveP > 0 && procKrw > 0 ? Math.round((1 - procKrw / liveP) * 1000) / 1000 : null;

      priceMatrix.push({
        model: modelId,
        shape,
        liveBaseP: liveP,
        candidateBaseP: candidate.points,
        candidateStatus: candidate.status,
        candidateBlockedReason: candidate.reason ?? null,
        deltaP:
          candidate.points != null ? candidate.points - liveP : null,
        referenceRawKrw: Math.round(refKrw * 10) / 10,
        currentProcurementKrw: Math.round(procKrw * 10) / 10,
        actualRealizedMarginLivePath: realized,
        publishedTargetMargin: published.targetMargin,
        competitorBenchmarkPoints:
          getMarketBenchmarks(published.modelId)[0]?.competitorChargePoints ??
          published.marketBenchmark?.points ??
          null,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        head: "3c5555a2fe97f9097cf7b65aff5912574d72b805",
        fx: FX_SNAPSHOT,
        policyMatrix,
        priceMatrix,
        calibrationEvidence: {
          gemini31Official: GEMINI31_OFFICIAL_BASE_TIER_EVIDENCE,
          gemini31CiObserved: GEMINI31_CI_OBSERVED_DISCOUNT_EVIDENCE,
          gemini37Calibration: GEMINI37_CALIBRATION_RATE_EVIDENCE,
        },
      },
      null,
      2
    )
  );
}

main();

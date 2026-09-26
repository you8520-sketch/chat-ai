/**
 * BUGFIX pre-flight — model-specific operational + competitor-aligned matrices.
 * Run: node --conditions=react-server --import tsx scripts/billing-preflight-price-matrix.ts
 */
import { writeFileSync } from "node:fs";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
} from "@/lib/chatModels";
import {
  clearCheaperInferenceCatalogPricingForTest,
} from "@/lib/cheaperInferenceCatalogPricing";
import { normalizeBillableUsage, type NormalizedBillableUsage } from "@/lib/billingUsage";
import {
  MAIN_RP_MODEL_IDS,
  MAIN_RP_MODEL_PRICING_EVIDENCE,
  seedModelSpecificCatalog,
} from "@/lib/billingPreflightModelPricingEvidence";
import { computeOpenRouterTurnBilling } from "@/lib/points";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import { computePublishedUserChargeWithSnapshot } from "@/lib/publishedUserCharge";
import { resolveProcurementCostFromCatalog } from "@/lib/procurementCost";
import {
  GEMINI37_BENCHMARK_A_ID,
  GEMINI37_BENCHMARK_B_ID,
  getMarketBenchmark,
  getMarketBenchmarks,
  type MarketUsageBenchmark,
} from "@/lib/marketUsageBenchmarks";

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

const USAGE_SHAPES: Record<string, Record<Shape, NormalizedBillableUsage>> = {
  [CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL]: {
    NORMAL: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      promptTokens: 33_247,
      outputTokens: 3_461,
    }),
    MEMORY_HEAVY: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      promptTokens: 12_871,
      outputTokens: 1_273,
      cacheReadTokens: 12_800,
    }),
    BOUNDED_VALID_STRESS: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      promptTokens: 80_000,
      outputTokens: 5_000,
    }),
  },
  [CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL]: {
    NORMAL: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      promptTokens: 15_233,
      outputTokens: 2_070,
    }),
    MEMORY_HEAVY: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      promptTokens: 40_689,
      outputTokens: 4_307,
    }),
    BOUNDED_VALID_STRESS: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      promptTokens: 199_000,
      outputTokens: 3_000,
    }),
  },
  [CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL]: {
    NORMAL: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      promptTokens: 24_952,
      outputTokens: 2_367,
    }),
    MEMORY_HEAVY: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      promptTokens: 26_038,
      outputTokens: 2_662,
      cacheReadTokens: 20_426,
    }),
    BOUNDED_VALID_STRESS: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      promptTokens: 42_195,
      outputTokens: 3_862,
    }),
  },
  [CHEAPER_INFERENCE_GPT_56_TERRA_MODEL]: {
    NORMAL: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      promptTokens: 12_000,
      outputTokens: 900,
    }),
    MEMORY_HEAVY: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      promptTokens: 35_000,
      outputTokens: 2_500,
    }),
    BOUNDED_VALID_STRESS: normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      promptTokens: 55_000,
      outputTokens: 4_000,
    }),
  },
};

function referenceRawKrw(modelId: string, usage: NormalizedBillableUsage): number {
  const published = getPublishedPricing(modelId);
  const usd =
    (usage.standardInputTokens / 1_000_000) * published.billingReferenceInputUsdPerMillion +
    (usage.cacheReadTokens / 1_000_000) *
      (published.billingReferenceCacheReadUsdPerMillion ?? 0) +
    (usage.cacheWriteTokens / 1_000_000) *
      (published.billingReferenceCacheWriteUsdPerMillion ?? 0) +
    (usage.billableOutputTokens / 1_000_000) * published.billingReferenceOutputUsdPerMillion;
  return Math.round(usd * EFFECTIVE_FX * 10) / 10;
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

function candidateResult(modelId: string, usage: NormalizedBillableUsage) {
  return computePublishedUserChargeWithSnapshot({
    modelId,
    usage,
    usageCoverage: "complete",
    fxSnapshot: FX_SNAPSHOT,
    adjustment: { kind: "none" },
  });
}

function procurementKrw(
  modelId: string,
  usage: NormalizedBillableUsage,
  seeded: boolean
): number | null {
  if (!seeded) return null;
  const snap = resolveProcurementCostFromCatalog({
    modelId,
    promptTokens: usage.promptTokens,
    outputTokens: usage.billableOutputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    effectiveKrwPerUsd: FX,
  });
  return snap ? Math.round(snap.procurementCostKrw * 10) / 10 : null;
}

function marginNumerator(baseP: number, procKrw: number | null): number | null {
  if (baseP <= 0 || procKrw == null || procKrw <= 0) return null;
  return Math.round(((baseP - procKrw) / baseP) * 1000) / 1000;
}

function benchmarkToUsage(b: MarketUsageBenchmark): NormalizedBillableUsage {
  return normalizeBillableUsage({
    modelId: b.modelId,
    promptTokens: b.inputTokens,
    outputTokens: b.displayedOutputTokens,
    reasoningTokens: b.displayedReasoningTokens ?? 0,
  });
}

function buildOperationalMatrix() {
  clearCheaperInferenceCatalogPricingForTest();
  const rows: unknown[] = [];

  for (const modelId of MAIN_RP_MODEL_IDS) {
    const evidence = MAIN_RP_MODEL_PRICING_EVIDENCE[modelId];
    const seeded = seedModelSpecificCatalog(modelId);
    const refSource = evidence.reference.evidenceSource;
    const curSource =
      evidence.currentProcurement.status === "known"
        ? evidence.currentProcurement.source
        : "CURRENT_PROCUREMENT_UNKNOWN";
    const curTimestamp =
      evidence.currentProcurement.status === "known"
        ? evidence.currentProcurement.observedAt
        : null;

    for (const shape of ["NORMAL", "MEMORY_HEAVY", "BOUNDED_VALID_STRESS"] as Shape[]) {
      const usage = USAGE_SHAPES[modelId][shape];
      const liveP = liveBaseP(modelId, usage);
      const candidate = candidateResult(modelId, usage);
      const procKrw = procurementKrw(modelId, usage, seeded);
      const refKrw = referenceRawKrw(modelId, usage);
      const candidateP =
        candidate.status === "complete" ? candidate.snapshot.finalPoints : null;

      rows.push({
        model: modelId,
        shape,
        referencePricingSource: refSource,
        currentProcurementSource: curSource,
        currentEvidenceTimestamp: curTimestamp,
        currentLiveBaseP: liveP,
        candidateStableBaseP: candidateP,
        deltaP: candidateP != null ? candidateP - liveP : null,
        referenceRawKrw: refKrw,
        currentProcurementKrw: procKrw,
        currentLiveRealizedMargin: marginNumerator(liveP, procKrw),
        candidatePostCutoverRealizedMargin: marginNumerator(candidateP ?? 0, procKrw),
        candidateStatus: candidate.status,
        blockedReason: candidate.status === "blocked" ? candidate.reason : null,
      });
    }
    clearCheaperInferenceCatalogPricingForTest();
  }

  return rows;
}

function buildCompetitorAlignedMatrix() {
  const rows: unknown[] = [];

  // Gemini 3.1 — exact benchmark workload
  const g31Bench = getMarketBenchmark(
    CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    "gemini31_competitor_a"
  );
  if (g31Bench) {
    const usage = benchmarkToUsage(g31Bench);
    const candidate = candidateResult(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, usage);
    const ourP = candidate.status === "complete" ? candidate.snapshot.finalPoints : null;
    rows.push({
      model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      benchmarkId: g31Bench.id,
      benchmarkSource: g31Bench.sourceLabel,
      benchmarkExactUsage: {
        promptTokens: g31Bench.inputTokens,
        outputTokens: g31Bench.displayedOutputTokens,
      },
      comparability: "EXACT_WORKLOAD",
      ourCandidateP: ourP,
      competitorP: g31Bench.competitorChargePoints,
      deltaP: ourP != null ? ourP - g31Bench.competitorChargePoints : null,
      deltaPercent:
        ourP != null
          ? Math.round(
              ((ourP - g31Bench.competitorChargePoints) / g31Bench.competitorChargePoints) *
                1000
            ) / 10
          : null,
      pricingVersion: getPublishedPricing(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL)
        .pricingVersion,
      referenceEvidenceSource: MAIN_RP_MODEL_PRICING_EVIDENCE[
        CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL
      ].reference.evidenceSource,
      candidateStatus: candidate.status,
      blockedReason: candidate.status === "blocked" ? candidate.reason : null,
    });
  }

  // Gemini 3.7 — benchmarks A and B
  for (const benchId of [GEMINI37_BENCHMARK_A_ID, GEMINI37_BENCHMARK_B_ID]) {
    const bench = getMarketBenchmark(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, benchId);
    if (!bench) continue;
    const usage = benchmarkToUsage(bench);
    const candidate = candidateResult(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, usage);
    const ourP = candidate.status === "complete" ? candidate.snapshot.finalPoints : null;
    rows.push({
      model: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      benchmarkId: bench.id,
      benchmarkSource: bench.sourceLabel,
      benchmarkExactUsage: {
        promptTokens: bench.inputTokens,
        outputTokens: bench.displayedOutputTokens,
      },
      comparability: "EXACT_WORKLOAD",
      ourCandidateP: ourP,
      competitorP: bench.competitorChargePoints,
      deltaP: ourP != null ? ourP - bench.competitorChargePoints : null,
      deltaPercent:
        ourP != null
          ? Math.round(((ourP - bench.competitorChargePoints) / bench.competitorChargePoints) * 1000) /
            10
          : null,
      pricingVersion: getPublishedPricing(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL).pricingVersion,
      referenceEvidenceSource:
        MAIN_RP_MODEL_PRICING_EVIDENCE[CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL].reference
          .evidenceSource,
      candidateStatus: candidate.status,
      blockedReason: candidate.status === "blocked" ? candidate.reason : null,
    });
  }

  // Terra — chars-only benchmark
  const terraPublished = getPublishedPricing(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL);
  if (terraPublished.marketBenchmark) {
    rows.push({
      model: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      benchmarkId: "published_marketBenchmark_chars",
      benchmarkSource: "publishedModelPricing.marketBenchmark",
      benchmarkExactUsage: {
        outputChars: terraPublished.marketBenchmark.outputChars,
        promptTokens: null,
        outputTokens: null,
      },
      comparability: "NOT_DIRECTLY_COMPARABLE",
      ourCandidateP: null,
      competitorP: terraPublished.marketBenchmark.points,
      deltaP: null,
      deltaPercent: null,
      pricingVersion: terraPublished.pricingVersion,
      referenceEvidenceSource:
        MAIN_RP_MODEL_PRICING_EVIDENCE[CHEAPER_INFERENCE_GPT_56_TERRA_MODEL].reference
          .evidenceSource,
      reason: "Benchmark is char-based only; no exact token workload to reproduce candidate charge",
    });
  }

  // DeepSeek — no benchmark
  rows.push({
    model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    benchmarkId: null,
    comparability: "COMPETITOR_BENCHMARK_MISSING",
    competitorP: null,
    ourCandidateP: null,
    reason: "No competitor benchmark registered in marketUsageBenchmarks.ts",
  });

  void getMarketBenchmarks;

  return rows;
}

function buildOutput() {
  return {
    head: "3c5555a2fe97f9097cf7b65aff5912574d72b805",
    correction: "PR #991 exact-head — model-specific evidence (no shared G31 CI_FIXTURE)",
    fx: FX_SNAPSHOT,
    modelPricingEvidence: MAIN_RP_MODEL_PRICING_EVIDENCE,
    operationalMatrix: buildOperationalMatrix(),
    competitorAlignedMatrix: buildCompetitorAlignedMatrix(),
  };
}

function main(): void {
  const json = JSON.stringify(buildOutput(), null, 2);
  const outPath = process.env.PREFLIGHT_MATRIX_OUT;
  if (outPath) {
    writeFileSync(outPath, json, "utf8");
  } else {
    console.log(json);
  }
}

main();

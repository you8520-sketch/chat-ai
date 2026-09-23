/**
 * Claude Opus 5.5 — Main RP pricing prep (read-only / diagnostic).
 * PRODUCT billing reference follows Anthropic official list rates.
 * PROCUREMENT uses CheaperInference current effective rates (not user-facing discount).
 * Does not mutate live published catalog target margin — commercial decision is external.
 */

import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import { CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL } from "@/lib/chatModels";
import type { CheaperInferenceCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing";
import { resolveProcurementCostFromCatalog } from "@/lib/procurementCost";
import type { PublishedModelPricing } from "@/lib/publishedModelPricing";
import {
  computePublishedUserChargeFromResolvedPolicy,
  type PublishedUserChargeResult,
} from "@/lib/publishedUserCharge";
import { KOREAN_CHARS_PER_OUTPUT_TOKEN } from "@/lib/responseLengthConstants";

/** CheaperInference wire id — verified via GET /v1/models catalog. */
export { CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL } from "@/lib/chatModels";

/** Anthropic official list (PRODUCT billing reference semantic). */
export const OPUS55_OFFICIAL_LIST_INPUT_USD_PER_MILLION = 4;
export const OPUS55_OFFICIAL_LIST_OUTPUT_USD_PER_MILLION = 20;

/** CheaperInference effective procurement (30% off list — procurement only). */
export const OPUS55_CI_PROCUREMENT_INPUT_USD_PER_MILLION = 2.8;
export const OPUS55_CI_PROCUREMENT_OUTPUT_USD_PER_MILLION = 14;
export const OPUS55_CI_PROCUREMENT_DISCOUNT_PERCENT = 30;

export const OPUS55_PREP_INPUT_TOKEN_WORKLOADS = [15_000, 25_000, 35_000, 45_000, 75_000] as const;

export const OPUS55_PREP_OUTPUT_CHAR_PRESETS = [1500, 2500, 3500, 4360, 5000] as const;

export type Opus55PrepOutputPreset = {
  chars: number;
  equivalentOutputTokens: number;
};

export function listOpus55PrepOutputPresets(): Opus55PrepOutputPreset[] {
  return OPUS55_PREP_OUTPUT_CHAR_PRESETS.map((chars) => ({
    chars,
    equivalentOutputTokens: Math.round(chars / KOREAN_CHARS_PER_OUTPUT_TOKEN),
  }));
}

/** Prep published policy — no cache reference rates (user P must not depend on cache split). */
export function buildOpus55PrepPublishedPricing(targetMargin: number): PublishedModelPricing {
  return {
    modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    billingReferenceInputUsdPerMillion: OPUS55_OFFICIAL_LIST_INPUT_USD_PER_MILLION,
    billingReferenceOutputUsdPerMillion: OPUS55_OFFICIAL_LIST_OUTPUT_USD_PER_MILLION,
    targetMargin,
    minimumMarginFloor: 0.05,
    /** Prep-only snapshot — not live published catalog; commercial targetMargin supplied per matrix. */
    pricingVersion: 1,
    publishedAt: "2026-09-23T00:00:00.000Z",
  };
}

export function buildOpus55PrepProcurementCatalog(
  overrides?: Partial<CheaperInferenceCatalogPricing>
): CheaperInferenceCatalogPricing {
  return {
    modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    inputUsdPerMillion: OPUS55_CI_PROCUREMENT_INPUT_USD_PER_MILLION,
    outputUsdPerMillion: OPUS55_CI_PROCUREMENT_OUTPUT_USD_PER_MILLION,
    cacheReadUsdPerMillion: OPUS55_CI_PROCUREMENT_INPUT_USD_PER_MILLION * 0.1,
    cacheWriteUsdPerMillion: OPUS55_CI_PROCUREMENT_INPUT_USD_PER_MILLION,
    referenceInputUsdPerMillion: OPUS55_OFFICIAL_LIST_INPUT_USD_PER_MILLION,
    referenceOutputUsdPerMillion: OPUS55_OFFICIAL_LIST_OUTPUT_USD_PER_MILLION,
    discountPercent: OPUS55_CI_PROCUREMENT_DISCOUNT_PERCENT,
    fetchedAt: Date.now(),
    ...overrides,
  };
}

/** PRODUCT charge — billable prompt/output only; cache buckets forced to zero for user P. */
export function computeOpus55PrepProductCharge(params: {
  promptTokens: number;
  outputTokens: number;
  targetMargin: number;
  fxSnapshot: BillingFxSnapshot;
}): PublishedUserChargeResult {
  const usage = normalizeBillableUsage({
    modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    promptTokens: params.promptTokens,
    outputTokens: params.outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  return computePublishedUserChargeFromResolvedPolicy({
    requestedModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    resolvedPricing: {
      requestedModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      canonicalModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      pricing: buildOpus55PrepPublishedPricing(params.targetMargin),
    },
    usage,
    usageCoverage: "complete",
    fxSnapshot: params.fxSnapshot,
    adjustment: { kind: "none" },
  });
}

export type Opus55PriceMatrixCell = {
  promptTokens: number;
  outputTokens: number;
  outputChars: number | null;
  userChargePoints: number | null;
  userChargeKrw: number | null;
  anthropicListCostKrw: number | null;
  procurementCostKrwNoCache: number | null;
  procurementCostKrwRepresentativeCacheHit: number | null;
  grossMarginPercentNoCache: number | null;
  userChargeInvariantNote: string;
};

function grossMarginPercent(chargeKrw: number, procurementKrw: number): number | null {
  if (!Number.isFinite(chargeKrw) || chargeKrw <= 0) return null;
  return ((chargeKrw - procurementKrw) / chargeKrw) * 100;
}

export function buildOpus55PriceMatrix(params: {
  targetMargin: number;
  fxSnapshot: BillingFxSnapshot;
  catalog?: CheaperInferenceCatalogPricing;
}): Opus55PriceMatrixCell[] {
  const catalog = params.catalog ?? buildOpus55PrepProcurementCatalog();
  const cells: Opus55PriceMatrixCell[] = [];
  const outputPresets = listOpus55PrepOutputPresets();

  for (const promptTokens of OPUS55_PREP_INPUT_TOKEN_WORKLOADS) {
    for (const preset of outputPresets) {
      const charge = computeOpus55PrepProductCharge({
        promptTokens,
        outputTokens: preset.equivalentOutputTokens,
        targetMargin: params.targetMargin,
        fxSnapshot: params.fxSnapshot,
      });
      const userChargeKrw =
        charge.status === "complete" ? charge.snapshot.finalUserChargeKrw : null;
      const userChargePoints =
        charge.status === "complete" ? charge.snapshot.finalPoints : null;

      const listProcurement = resolveProcurementCostFromCatalog({
        modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
        promptTokens,
        outputTokens: preset.equivalentOutputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        effectiveKrwPerUsd: params.fxSnapshot.effectiveKrwPerUsd,
        catalog: {
          ...catalog,
          inputUsdPerMillion: OPUS55_OFFICIAL_LIST_INPUT_USD_PER_MILLION,
          outputUsdPerMillion: OPUS55_OFFICIAL_LIST_OUTPUT_USD_PER_MILLION,
          referenceInputUsdPerMillion: OPUS55_OFFICIAL_LIST_INPUT_USD_PER_MILLION,
          referenceOutputUsdPerMillion: OPUS55_OFFICIAL_LIST_OUTPUT_USD_PER_MILLION,
        },
      });

      const procurementNoCache = resolveProcurementCostFromCatalog({
        modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
        promptTokens,
        outputTokens: preset.equivalentOutputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        effectiveKrwPerUsd: params.fxSnapshot.effectiveKrwPerUsd,
        catalog,
      });

      const representativeCacheRead = Math.min(
        Math.floor(promptTokens * 0.5),
        promptTokens
      );
      const procurementCacheHit = resolveProcurementCostFromCatalog({
        modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
        promptTokens,
        outputTokens: preset.equivalentOutputTokens,
        cacheReadTokens: representativeCacheRead,
        cacheWriteTokens: 0,
        effectiveKrwPerUsd: params.fxSnapshot.effectiveKrwPerUsd,
        catalog,
      });

      cells.push({
        promptTokens,
        outputTokens: preset.equivalentOutputTokens,
        outputChars: preset.chars,
        userChargePoints,
        userChargeKrw,
        anthropicListCostKrw: listProcurement?.procurementCostKrw ?? null,
        procurementCostKrwNoCache: procurementNoCache?.procurementCostKrw ?? null,
        procurementCostKrwRepresentativeCacheHit:
          procurementCacheHit?.procurementCostKrw ?? null,
        grossMarginPercentNoCache:
          userChargeKrw != null && procurementNoCache != null
            ? grossMarginPercent(userChargeKrw, procurementNoCache.procurementCostKrw)
            : null,
        userChargeInvariantNote:
          "USER P uses published PRODUCT engine with cache buckets=0 — identical for any provider cache state.",
      });
    }
  }
  return cells;
}

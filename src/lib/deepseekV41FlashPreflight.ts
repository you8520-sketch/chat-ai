/**
 * DeepSeek V4.1 Flash feature pre-flight — read-only candidate pricing & identity.
 * NOT live billing. PRICE_CUTOVER = NO.
 */

import { normalizeBillableUsage, type NormalizedBillableUsage } from "@/lib/billingUsage";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import { SEMANTICS_AUDIT_FX } from "@/lib/billingPricingSemanticsAudit";

/** New canonical CI model id — do NOT overwrite deepseek-v4-flash-0731. */
export const DEEPSEEK_V41_FLASH_CANDIDATE_MODEL_ID = "deepseek-v4.1-flash";

/** Official DeepSeek API name (direct API); CI uses dotted id above. */
export const DEEPSEEK_V41_FLASH_OFFICIAL_API_NAME = "deepseek-flash";

export const DEEPSEEK_V41_FLASH_PEAK_BASELINE = {
  cacheMissInputUsdPerMillion: 0.3,
  outputUsdPerMillion: 1.2,
  cacheHitInputUsdPerMillion: 0.006,
} as const;

export const DEEPSEEK_V41_FLASH_OFFPEAK_PROCUREMENT = {
  cacheMissInputUsdPerMillion: 0.15,
  outputUsdPerMillion: 0.6,
  cacheHitInputUsdPerMillion: 0.003,
} as const;

export const DEEPSEEK_V4_PRO_PEAK_BASELINE = {
  cacheMissInputUsdPerMillion: 1.32,
  outputUsdPerMillion: 3.96,
  cacheHitInputUsdPerMillion: 0.044,
} as const;

/** Product decision: Flash candidate = Pro published target + 10pp. */
export const DEEPSEEK_V41_FLASH_CANDIDATE_TARGET_MARGIN = 0.6;

export const DEEPSEEK_V41_FLASH_DETERMINISTIC_CANDIDATE = {
  modelId: DEEPSEEK_V41_FLASH_CANDIDATE_MODEL_ID,
  billingReferenceInputUsdPerMillion: DEEPSEEK_V41_FLASH_PEAK_BASELINE.cacheMissInputUsdPerMillion,
  billingReferenceOutputUsdPerMillion: DEEPSEEK_V41_FLASH_PEAK_BASELINE.outputUsdPerMillion,
  billingReferenceCacheReadUsdPerMillion: DEEPSEEK_V41_FLASH_PEAK_BASELINE.cacheHitInputUsdPerMillion,
  targetMargin: DEEPSEEK_V41_FLASH_CANDIDATE_TARGET_MARGIN,
  pricingVersion: 0,
  publishedAt: "2026-09-20T00:00:00.000Z",
  note: "PREFLIGHT_CANDIDATE_ONLY — not in publishedModelPricing catalog",
} as const;

/** CI catalog snapshot captured 2026-09-20 preflight (live /v1/models). */
export const CI_DEEPSEEK_V41_FLASH_SNAPSHOT = {
  observedAt: "2026-09-20T00:00:00.000Z",
  listInputUsdPerMillion: 0.3,
  listOutputUsdPerMillion: 1.2,
  currentInputUsdPerMillion: 0.120853,
  currentOutputUsdPerMillion: 0.483412,
  currentCacheReadUsdPerMillion: 0.002417,
  discountPercent: 59.72,
  contextLength: 1_048_576,
  maxOutputTokens: 384_000,
  source: "cheaperinference.com/v1/models",
} as const;

export const CI_DEEPSEEK_V4_PRO_0813_SNAPSHOT = {
  observedAt: "2026-09-20T00:00:00.000Z",
  listInputUsdPerMillion: 0.66,
  listOutputUsdPerMillion: 1.98,
  currentInputUsdPerMillion: 0.442418,
  currentOutputUsdPerMillion: 1.327256,
  currentCacheReadUsdPerMillion: 0.003661,
  discountPercent: 32.97,
  source: "cheaperinference.com/v1/models",
} as const;

export const CI_DEEPSEEK_V4_FLASH_0731_SNAPSHOT = {
  observedAt: "2026-09-20T00:00:00.000Z",
  listInputUsdPerMillion: 0.076,
  listOutputUsdPerMillion: 0.153,
  currentInputUsdPerMillion: 0.032227,
  currentOutputUsdPerMillion: 0.064454,
  discountPercent: 57.6,
  maxOutputTokens: 65_536,
  source: "cheaperinference.com/v1/models",
  note: "Legacy id — distinct from deepseek-v4.1-flash; do not overwrite",
} as const;

export type PreflightUsageShape = "NORMAL" | "MEMORY_HEAVY" | "BOUNDED_STRESS";

export const PREFLIGHT_USAGE_SHAPES: Record<
  PreflightUsageShape,
  NormalizedBillableUsage
> = {
  NORMAL: normalizeBillableUsage({
    modelId: DEEPSEEK_V41_FLASH_CANDIDATE_MODEL_ID,
    promptTokens: 33_247,
    outputTokens: 3_461,
  }),
  MEMORY_HEAVY: normalizeBillableUsage({
    modelId: DEEPSEEK_V41_FLASH_CANDIDATE_MODEL_ID,
    promptTokens: 12_871,
    outputTokens: 1_273,
    cacheReadTokens: 12_800,
  }),
  BOUNDED_STRESS: normalizeBillableUsage({
    modelId: DEEPSEEK_V41_FLASH_CANDIDATE_MODEL_ID,
    promptTokens: 80_000,
    outputTokens: 5_000,
  }),
};

export type PreflightPriceMatrixRow = {
  shape: PreflightUsageShape;
  referencePeakRawKrw: number;
  candidateBaseP: number;
  ciProcurementKrw: number;
  candidateRealizedMargin: number;
  v4ProPeakBaseP: number;
  flashToProPriceRatio: number;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function chargePoints(rawKrw: number, margin: number): number {
  if (!Number.isFinite(rawKrw) || rawKrw <= 0) return 0;
  return Math.ceil(rawKrw / (1 - margin) - 1e-9);
}

function usageCostKrw(
  usage: NormalizedBillableUsage,
  inputUsdPerMillion: number,
  outputUsdPerMillion: number,
  cacheReadUsdPerMillion = 0
): number {
  const usd =
    (usage.standardInputTokens / 1_000_000) * inputUsdPerMillion +
    (usage.cacheReadTokens / 1_000_000) * cacheReadUsdPerMillion +
    (usage.billableOutputTokens / 1_000_000) * outputUsdPerMillion;
  return round1(usd * SEMANTICS_AUDIT_FX.effectiveKrwPerUsd);
}

export function buildV41FlashCandidatePriceMatrix(): PreflightPriceMatrixRow[] {
  const flash = DEEPSEEK_V41_FLASH_DETERMINISTIC_CANDIDATE;
  const ci = CI_DEEPSEEK_V41_FLASH_SNAPSHOT;
  const proPublished = getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);

  return (Object.keys(PREFLIGHT_USAGE_SHAPES) as PreflightUsageShape[]).map((shape) => {
    const usage = PREFLIGHT_USAGE_SHAPES[shape];
    const referencePeakRawKrw = usageCostKrw(
      usage,
      flash.billingReferenceInputUsdPerMillion,
      flash.billingReferenceOutputUsdPerMillion,
      flash.billingReferenceCacheReadUsdPerMillion ?? 0
    );
    const candidateBaseP = chargePoints(referencePeakRawKrw, flash.targetMargin);
    const ciProcurementKrw = usageCostKrw(
      usage,
      ci.currentInputUsdPerMillion,
      ci.currentOutputUsdPerMillion,
      ci.currentCacheReadUsdPerMillion
    );
    const v4ProPeakBaseP = chargePoints(
      usageCostKrw(
        usage,
        DEEPSEEK_V4_PRO_PEAK_BASELINE.cacheMissInputUsdPerMillion,
        DEEPSEEK_V4_PRO_PEAK_BASELINE.outputUsdPerMillion,
        DEEPSEEK_V4_PRO_PEAK_BASELINE.cacheHitInputUsdPerMillion
      ),
      proPublished.targetMargin
    );
    return {
      shape,
      referencePeakRawKrw,
      candidateBaseP,
      ciProcurementKrw,
      candidateRealizedMargin:
        candidateBaseP > 0 ? round1((candidateBaseP - ciProcurementKrw) / candidateBaseP) : 0,
      v4ProPeakBaseP,
      flashToProPriceRatio:
        v4ProPeakBaseP > 0 ? round1(candidateBaseP / v4ProPeakBaseP) : 0,
    };
  });
}

export type LegacyFlashAliasClassification =
  | "KEEP"
  | "MIGRATE"
  | "OBSOLETE"
  | "FOLLOW-UP";

export const LEGACY_FLASH_ALIAS_MAP: Array<{
  id: string;
  classification: LegacyFlashAliasClassification;
  notes: string;
}> = [
  {
    id: "deepseek-v4-flash-0731",
    classification: "KEEP",
    notes: "Background/TRPG/wire canonical until explicit migration; CI catalog distinct from v4.1-flash",
  },
  {
    id: "deepseek-v4-flash",
    classification: "MIGRATE",
    notes: "Legacy alias → 0731 on wire; official routes to V4.1-Flash at Flash price — new user-facing id should be deepseek-v4.1-flash not 0731",
  },
  {
    id: "deepseek/deepseek-v4-flash-0731",
    classification: "KEEP",
    notes: "OR backup slug; Flash logical backup uses Gemini 3.1 Flash-Lite in failover",
  },
  {
    id: "deepseek-v4.1-flash",
    classification: "FOLLOW-UP",
    notes: "CI catalog present; not yet in chatModels registry or picker",
  },
  {
    id: "deepseek-flash",
    classification: "FOLLOW-UP",
    notes: "Official API name; map at transport layer if direct DeepSeek API used",
  },
];

export const DEAD_SYSTEM_AUDIT = [
  {
    item: "deepseek-v4-flash-0731 published v1 row (0.098/0.196)",
    verdict: "KEEP",
    reason: "Still used by background paths; distinct CI pricing from v4.1-flash",
  },
  {
    item: "pointsReasoningMargins CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_* constants",
    verdict: "KEEP",
    reason: "Live fallback for 0731 background until migration plan",
  },
  {
    item: "LEGACY_TO_SELECTED deepseek-v4-flash → DEFAULT_SELECTED_AI (Pro)",
    verdict: "KEEP",
    reason: "Prevents accidental Main RP Flash selection via legacy id",
  },
  {
    item: "openRouterModelPricing CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_RATES",
    verdict: "FOLLOW-UP",
    reason: "Stale vs v4.1-flash CI snapshot; update only after identity cutover design",
  },
  {
    item: "publishedModelPricing deepseek-v4-flash-0731 v1",
    verdict: "FOLLOW-UP",
    reason: "Do not repurpose for v4.1-flash; add new row on cutover",
  },
] as const;

export const REGRESSION_GATES = [
  "V4 Pro routing unchanged (deepseek-v4-pro-0813 Main RP default)",
  "V4 Pro billing unchanged (published v2 0.66/1.98 + live CI overlay)",
  "deepseekProviderFailover Main RP single-attempt policy unchanged",
  "official/site promotions unchanged",
  "Regen uses deliveredModelId + selectedAI without model switch",
  "Flash procurement discount must not move BASE (stable-reference policy)",
  "Returned responseModelId vs requested mismatch must surface in ledger actual_model",
  "deepseek-v4.1-flash must not alias-overwrite deepseek-v4-flash-0731",
] as const;

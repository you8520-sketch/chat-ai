/**
 * BUGFIX pre-flight audit — model-specific pricing evidence registry (audit-only).
 * NOT a live billing owner. Each Main RP model has isolated reference/current evidence.
 */

import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
} from "@/lib/chatModels";
import {
  updateCheaperInferenceCatalogPricing,
  type CheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_CACHED_INPUT_USD_PER_MILLION,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_INPUT_USD_PER_MILLION,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_OUTPUT_USD_PER_MILLION,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_CACHED_INPUT_USD_PER_MILLION,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_CACHE_WRITE_USD_PER_MILLION,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_INPUT_USD_PER_MILLION,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_OUTPUT_USD_PER_MILLION,
} from "@/lib/pointsReasoningMargins";
import { GEMINI37_CALIBRATION_RATE_EVIDENCE } from "@/lib/gemini37CalibrationEvidence";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import {
  GEMINI31_CI_OBSERVED_DISCOUNT_EVIDENCE,
  GEMINI31_OFFICIAL_BASE_TIER_EVIDENCE,
} from "@/lib/premiumPricingCalibrationEvidence";

/** Architecture-only — NOT model-specific operational economics. */
export const SYNTHETIC_PROCUREMENT_SWING_FIXTURE = {
  label: "SYNTHETIC_PROCUREMENT_SWING_FIXTURE",
  modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  referenceIn: 100,
  referenceOut: 100,
  currentLevels: [100, 70, 40] as const,
  usage: { promptTokens: 10_000, outputTokens: 2_000 },
} as const;

export type CurrentProcurementEvidence =
  | {
      status: "known";
      inputUsdPerMillion: number;
      outputUsdPerMillion: number;
      cacheReadUsdPerMillion?: number;
      cacheWriteUsdPerMillion?: number;
      discountPercent?: number | null;
      source: string;
      observedAt: string;
    }
  | {
      status: "CURRENT_PROCUREMENT_UNKNOWN";
      source: string;
      reason: string;
    };

export type ReferencePricingEvidence = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion?: number;
  cacheWriteUsdPerMillion?: number;
  sourceOwner: string;
  evidenceSource: string;
  observedAt: string;
};

export type MainRpModelPricingEvidence = {
  modelId: string;
  reference: ReferencePricingEvidence;
  currentProcurement: CurrentProcurementEvidence;
};

function deepSeekEvidence(): MainRpModelPricingEvidence {
  const published = getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
  return {
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    reference: {
      inputUsdPerMillion: published.billingReferenceInputUsdPerMillion,
      outputUsdPerMillion: published.billingReferenceOutputUsdPerMillion,
      cacheReadUsdPerMillion: published.billingReferenceCacheReadUsdPerMillion,
      sourceOwner: "publishedModelPricing.ts",
      evidenceSource: "Published v2 Phase-2 row (2026-09-02)",
      observedAt: published.publishedAt,
    },
    currentProcurement: {
      status: "known",
      inputUsdPerMillion: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_INPUT_USD_PER_MILLION,
      outputUsdPerMillion: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_OUTPUT_USD_PER_MILLION,
      cacheReadUsdPerMillion: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_CACHED_INPUT_USD_PER_MILLION,
      source: "pointsReasoningMargins.ts CI account catalog fallback (2026-07-29)",
      observedAt: "2026-07-29T00:00:00.000Z",
    },
  };
}

function gemini31Evidence(): MainRpModelPricingEvidence {
  return {
    modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    reference: {
      inputUsdPerMillion: GEMINI31_OFFICIAL_BASE_TIER_EVIDENCE.inputUsdPerMillion!,
      outputUsdPerMillion: GEMINI31_OFFICIAL_BASE_TIER_EVIDENCE.outputUsdPerMillion!,
      sourceOwner: "premiumPricingCalibrationEvidence.ts",
      evidenceSource: GEMINI31_OFFICIAL_BASE_TIER_EVIDENCE.sourceLabel,
      observedAt: GEMINI31_OFFICIAL_BASE_TIER_EVIDENCE.observedAt,
    },
    currentProcurement: {
      status: "known",
      inputUsdPerMillion: GEMINI31_CI_OBSERVED_DISCOUNT_EVIDENCE.inputUsdPerMillion!,
      outputUsdPerMillion: GEMINI31_CI_OBSERVED_DISCOUNT_EVIDENCE.outputUsdPerMillion!,
      cacheReadUsdPerMillion: 0.4375,
      cacheWriteUsdPerMillion: 1.4,
      discountPercent: GEMINI31_CI_OBSERVED_DISCOUNT_EVIDENCE.observedDiscountPercent ?? null,
      source: GEMINI31_CI_OBSERVED_DISCOUNT_EVIDENCE.sourceLabel,
      observedAt: GEMINI31_CI_OBSERVED_DISCOUNT_EVIDENCE.observedAt,
    },
  };
}

function gemini37Evidence(): MainRpModelPricingEvidence {
  const published = getPublishedPricing(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
  const ev = GEMINI37_CALIBRATION_RATE_EVIDENCE;
  return {
    modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    reference: {
      inputUsdPerMillion: published.billingReferenceInputUsdPerMillion,
      outputUsdPerMillion: published.billingReferenceOutputUsdPerMillion,
      sourceOwner: "publishedModelPricing.ts + gemini37CalibrationEvidence.ts",
      evidenceSource: ev.sourceKind,
      observedAt: ev.observedAt,
    },
    currentProcurement: {
      status: "known",
      inputUsdPerMillion: ev.observedCurrentInputUsdPerMillion,
      outputUsdPerMillion: ev.observedCurrentOutputUsdPerMillion,
      cacheReadUsdPerMillion: CHEAPER_INFERENCE_GEMINI_37_FLASH_CACHED_INPUT_USD_PER_MILLION,
      cacheWriteUsdPerMillion: CHEAPER_INFERENCE_GEMINI_37_FLASH_CACHE_WRITE_USD_PER_MILLION,
      discountPercent: ev.observedDiscountPercent,
      source: "gemini37CalibrationEvidence.ts observed CI snapshot",
      observedAt: ev.observedAt,
    },
  };
}

function terraEvidence(): MainRpModelPricingEvidence {
  const published = getPublishedPricing(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL);
  return {
    modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
    reference: {
      inputUsdPerMillion: published.billingReferenceInputUsdPerMillion,
      outputUsdPerMillion: published.billingReferenceOutputUsdPerMillion,
      cacheReadUsdPerMillion: published.billingReferenceCacheReadUsdPerMillion,
      cacheWriteUsdPerMillion: published.billingReferenceCacheWriteUsdPerMillion,
      sourceOwner: "publishedModelPricing.ts v2 (2026-09-19)",
      evidenceSource: "Published Terra v2 row + OpenAI list basis",
      observedAt: published.publishedAt,
    },
    currentProcurement: {
      status: "CURRENT_PROCUREMENT_UNKNOWN",
      source: "pointsReasoningMargins.ts direct-list fallback only",
      reason:
        "No separate reproducible CI discounted procurement snapshot; fallback constants equal published reference (2/12) — cannot distinguish list from current discount without live /v1/models fetch (PROVIDER_GENERATION_CALLS=0)",
    },
  };
}

export const MAIN_RP_MODEL_PRICING_EVIDENCE: Record<string, MainRpModelPricingEvidence> = {
  [CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL]: deepSeekEvidence(),
  [CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL]: gemini31Evidence(),
  [CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL]: gemini37Evidence(),
  [CHEAPER_INFERENCE_GPT_56_TERRA_MODEL]: terraEvidence(),
};

export const MAIN_RP_MODEL_IDS = [
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
] as const;

export function getMainRpModelPricingEvidence(modelId: string): MainRpModelPricingEvidence {
  const evidence = MAIN_RP_MODEL_PRICING_EVIDENCE[modelId.trim().toLowerCase()];
  if (!evidence) {
    throw new Error(`No preflight pricing evidence for model: ${modelId}`);
  }
  return evidence;
}

/** Seed in-memory CI catalog from model-specific current evidence only. Returns false when unknown. */
export function seedModelSpecificCatalog(modelId: string): boolean {
  const evidence = getMainRpModelPricingEvidence(modelId);
  if (evidence.currentProcurement.status !== "known") {
    return false;
  }
  const current = evidence.currentProcurement;
  const ref = evidence.reference;
  const catalog: CheaperInferenceCatalogPricing = {
    modelId,
    inputUsdPerMillion: current.inputUsdPerMillion,
    outputUsdPerMillion: current.outputUsdPerMillion,
    cacheReadUsdPerMillion:
      current.cacheReadUsdPerMillion ?? current.inputUsdPerMillion * 0.1,
    cacheWriteUsdPerMillion:
      current.cacheWriteUsdPerMillion ?? current.inputUsdPerMillion,
    referenceInputUsdPerMillion: ref.inputUsdPerMillion,
    referenceOutputUsdPerMillion: ref.outputUsdPerMillion,
    referenceCacheReadUsdPerMillion: ref.cacheReadUsdPerMillion,
    referenceCacheWriteUsdPerMillion: ref.cacheWriteUsdPerMillion,
    ...(current.discountPercent != null ? { discountPercent: current.discountPercent } : {}),
    fetchedAt: Date.parse(current.observedAt),
  };
  updateCheaperInferenceCatalogPricing(catalog);
  return true;
}

/** Guard: G31-shaped 1.4/8.4 current must not appear on non-G31 models. */
export function assertNoCrossModelFixtureLeak(modelId: string): void {
  const evidence = getMainRpModelPricingEvidence(modelId);
  if (modelId === CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL) return;
  if (evidence.currentProcurement.status !== "known") return;
  const { inputUsdPerMillion, outputUsdPerMillion } = evidence.currentProcurement;
  const isG31Leak = inputUsdPerMillion === 1.4 && outputUsdPerMillion === 8.4;
  if (isG31Leak) {
    throw new Error(`Cross-model fixture leak: ${modelId} uses G31 1.4/8.4 current`);
  }
}

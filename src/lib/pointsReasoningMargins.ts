import {
  billingModelId,
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_LEGACY_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_LEGACY_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  isCheaperInferenceModel,
  isCheaperInferenceClaudeOpus5Model,
  isCheaperInferenceDeepSeekV4FlashModel,
  isCheaperInferenceDeepSeekV4ProModel,
  isCheaperInferenceGemini31ProModel,
  isDeepSeekV4ProModel,
  isGemini36FlashModel,
  isGpt56LunaModel,
  isGpt56TerraModel,
  isMuseModel,
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
  isCheaperInferenceQwen38MaxModel,
  resolveSelectedAI,
} from "./chatModels";
import { getEffectiveKrwPerUsd } from "./exchangeRate";
import { resolveCheaperInferenceCatalogPricing } from "./cheaperInferenceCatalogPricing";
import * as core from "./pointsMuse60";

/** Standard, non-cache OpenRouter prices per 1M tokens. */
export const OPENROUTER_DEEPSEEK_V4_PRO_INPUT_USD_PER_MILLION = 0.435;
export const OPENROUTER_DEEPSEEK_V4_PRO_OUTPUT_USD_PER_MILLION = 0.87;
export const OPENROUTER_GEMINI_36_INPUT_USD_PER_MILLION = 1.5;
export const OPENROUTER_GEMINI_36_OUTPUT_USD_PER_MILLION = 7.5;
export const CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_INPUT_USD_PER_MILLION = 0.3045;
export const CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_CACHED_INPUT_USD_PER_MILLION =
  0.231;
export const CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_CACHE_WRITE_USD_PER_MILLION =
  0.3045;
export const CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_OUTPUT_USD_PER_MILLION = 0.609;
/** Cheaper Inference DeepSeek V4 Flash — account catalog snapshot (2026-07-29). */
export const CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_INPUT_USD_PER_MILLION = 0.098;
export const CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_CACHED_INPUT_USD_PER_MILLION =
  0.0196;
export const CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_CACHE_WRITE_USD_PER_MILLION =
  0.098;
export const CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_OUTPUT_USD_PER_MILLION = 0.196;
export const CHEAPER_INFERENCE_GPT_56_TERRA_INPUT_USD_PER_MILLION = 2.5;
export const CHEAPER_INFERENCE_GPT_56_TERRA_CACHED_INPUT_USD_PER_MILLION = 0.25;
export const CHEAPER_INFERENCE_GPT_56_TERRA_CACHE_WRITE_USD_PER_MILLION = 2.5;
export const CHEAPER_INFERENCE_GPT_56_TERRA_OUTPUT_USD_PER_MILLION = 15;
export const CHEAPER_INFERENCE_CLAUDE_OPUS_5_INPUT_USD_PER_MILLION = 3.5;
export const CHEAPER_INFERENCE_CLAUDE_OPUS_5_CACHED_INPUT_USD_PER_MILLION = 0.35;
export const CHEAPER_INFERENCE_CLAUDE_OPUS_5_CACHE_WRITE_USD_PER_MILLION = 4.375;
export const CHEAPER_INFERENCE_CLAUDE_OPUS_5_OUTPUT_USD_PER_MILLION = 17.5;
export const CHEAPER_INFERENCE_GPT_56_LUNA_INPUT_USD_PER_MILLION = 0.08;
export const CHEAPER_INFERENCE_GPT_56_LUNA_CACHED_INPUT_USD_PER_MILLION = 0.008;
export const CHEAPER_INFERENCE_GPT_56_LUNA_CACHE_WRITE_USD_PER_MILLION = 0.08;
export const CHEAPER_INFERENCE_GPT_56_LUNA_OUTPUT_USD_PER_MILLION = 0.48;
export const CHEAPER_INFERENCE_GEMINI_31_PRO_INPUT_USD_PER_MILLION = 1.4;
export const CHEAPER_INFERENCE_GEMINI_31_PRO_CACHED_INPUT_USD_PER_MILLION =
  0.4375;
export const CHEAPER_INFERENCE_GEMINI_31_PRO_CACHE_WRITE_USD_PER_MILLION = 1.4;
export const CHEAPER_INFERENCE_GEMINI_31_PRO_OUTPUT_USD_PER_MILLION = 8.4;

/** Requested gross margins. Muse remains 60% in the underlying owner. */
export const OPENROUTER_DEEPSEEK_V4_PRO_GROSS_MARGIN = 0.65;
export const OPENROUTER_GEMINI_36_GROSS_MARGIN = 0.5;
export const CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_GROSS_MARGIN = 0.65;
export const CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_GROSS_MARGIN = 0.68;
export const CHEAPER_INFERENCE_GPT_56_TERRA_GROSS_MARGIN = 0.5;
export const CHEAPER_INFERENCE_CLAUDE_OPUS_5_GROSS_MARGIN = 0.45;
export const CHEAPER_INFERENCE_GPT_56_LUNA_GROSS_MARGIN = 0.55;
export const CHEAPER_INFERENCE_GEMINI_31_PRO_GROSS_MARGIN = 0.5;
export const CHEAPER_INFERENCE_QWEN_38_MAX_GROSS_MARGIN = 0.55;
export const CHEAPER_INFERENCE_QWEN_38_MAX_INPUT_USD_PER_MILLION = 1.4;
export const CHEAPER_INFERENCE_QWEN_38_MAX_CACHED_INPUT_USD_PER_MILLION = 0.21875;
export const CHEAPER_INFERENCE_QWEN_38_MAX_CACHE_WRITE_USD_PER_MILLION = 2.1875;
export const CHEAPER_INFERENCE_QWEN_38_MAX_OUTPUT_USD_PER_MILLION = 4.2;

type ReasoningTokenPricing = {
  modelId: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  grossMargin: number;
  cacheReadUsdPerMillion?: number;
  cacheWriteUsdPerMillion?: number;
  longContextInputUsdPerMillion?: number;
  longContextCacheReadUsdPerMillion?: number;
  longContextCacheWriteUsdPerMillion?: number;
  longContextOutputUsdPerMillion?: number;
  longContextThresholdTokens?: number;
};

export type ReasoningPointRates = ReasoningTokenPricing & {
  effectiveKrwPerUsd: number;
  inputPointsPerToken: number;
  outputPointsPerToken: number;
};

const MUSE_PRICING: ReasoningTokenPricing = {
  modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
  inputUsdPerMillion: core.OPENROUTER_MUSE_INPUT_USD_PER_MILLION,
  outputUsdPerMillion: core.OPENROUTER_MUSE_OUTPUT_USD_PER_MILLION,
  grossMargin: core.OPENROUTER_MUSE_GROSS_MARGIN,
};

const DEEPSEEK_PRICING: ReasoningTokenPricing = {
  modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  inputUsdPerMillion: OPENROUTER_DEEPSEEK_V4_PRO_INPUT_USD_PER_MILLION,
  outputUsdPerMillion: OPENROUTER_DEEPSEEK_V4_PRO_OUTPUT_USD_PER_MILLION,
  grossMargin: OPENROUTER_DEEPSEEK_V4_PRO_GROSS_MARGIN,
};

const CHEAPER_INFERENCE_DEEPSEEK_PRICING: ReasoningTokenPricing = {
  modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  inputUsdPerMillion:
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_INPUT_USD_PER_MILLION,
  cacheReadUsdPerMillion:
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_CACHED_INPUT_USD_PER_MILLION,
  cacheWriteUsdPerMillion:
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_CACHE_WRITE_USD_PER_MILLION,
  outputUsdPerMillion:
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_OUTPUT_USD_PER_MILLION,
  grossMargin: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_GROSS_MARGIN,
};

const CHEAPER_INFERENCE_DEEPSEEK_FLASH_PRICING: ReasoningTokenPricing = {
  modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  inputUsdPerMillion:
    CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_INPUT_USD_PER_MILLION,
  cacheReadUsdPerMillion:
    CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_CACHED_INPUT_USD_PER_MILLION,
  cacheWriteUsdPerMillion:
    CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_CACHE_WRITE_USD_PER_MILLION,
  outputUsdPerMillion:
    CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_OUTPUT_USD_PER_MILLION,
  grossMargin: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_GROSS_MARGIN,
};

const GEMINI_36_PRICING: ReasoningTokenPricing = {
  modelId: OPENROUTER_GEMINI_36_FLASH_MODEL,
  inputUsdPerMillion: OPENROUTER_GEMINI_36_INPUT_USD_PER_MILLION,
  outputUsdPerMillion: OPENROUTER_GEMINI_36_OUTPUT_USD_PER_MILLION,
  grossMargin: OPENROUTER_GEMINI_36_GROSS_MARGIN,
};

const CHEAPER_INFERENCE_TERRA_PRICING: ReasoningTokenPricing = {
  modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  inputUsdPerMillion: CHEAPER_INFERENCE_GPT_56_TERRA_INPUT_USD_PER_MILLION,
  cacheReadUsdPerMillion:
    CHEAPER_INFERENCE_GPT_56_TERRA_CACHED_INPUT_USD_PER_MILLION,
  cacheWriteUsdPerMillion:
    CHEAPER_INFERENCE_GPT_56_TERRA_CACHE_WRITE_USD_PER_MILLION,
  outputUsdPerMillion: CHEAPER_INFERENCE_GPT_56_TERRA_OUTPUT_USD_PER_MILLION,
  grossMargin: CHEAPER_INFERENCE_GPT_56_TERRA_GROSS_MARGIN,
};

const CHEAPER_INFERENCE_CLAUDE_OPUS_5_PRICING: ReasoningTokenPricing = {
  modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  inputUsdPerMillion:
    CHEAPER_INFERENCE_CLAUDE_OPUS_5_INPUT_USD_PER_MILLION,
  cacheReadUsdPerMillion:
    CHEAPER_INFERENCE_CLAUDE_OPUS_5_CACHED_INPUT_USD_PER_MILLION,
  cacheWriteUsdPerMillion:
    CHEAPER_INFERENCE_CLAUDE_OPUS_5_CACHE_WRITE_USD_PER_MILLION,
  outputUsdPerMillion:
    CHEAPER_INFERENCE_CLAUDE_OPUS_5_OUTPUT_USD_PER_MILLION,
  grossMargin: CHEAPER_INFERENCE_CLAUDE_OPUS_5_GROSS_MARGIN,
};

const CHEAPER_INFERENCE_LUNA_PRICING: ReasoningTokenPricing = {
  modelId: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  inputUsdPerMillion: CHEAPER_INFERENCE_GPT_56_LUNA_INPUT_USD_PER_MILLION,
  cacheReadUsdPerMillion:
    CHEAPER_INFERENCE_GPT_56_LUNA_CACHED_INPUT_USD_PER_MILLION,
  cacheWriteUsdPerMillion:
    CHEAPER_INFERENCE_GPT_56_LUNA_CACHE_WRITE_USD_PER_MILLION,
  outputUsdPerMillion: CHEAPER_INFERENCE_GPT_56_LUNA_OUTPUT_USD_PER_MILLION,
  grossMargin: CHEAPER_INFERENCE_GPT_56_LUNA_GROSS_MARGIN,
};

const CHEAPER_INFERENCE_GEMINI_31_PRO_PRICING: ReasoningTokenPricing = {
  modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  inputUsdPerMillion: CHEAPER_INFERENCE_GEMINI_31_PRO_INPUT_USD_PER_MILLION,
  cacheReadUsdPerMillion:
    CHEAPER_INFERENCE_GEMINI_31_PRO_CACHED_INPUT_USD_PER_MILLION,
  cacheWriteUsdPerMillion:
    CHEAPER_INFERENCE_GEMINI_31_PRO_CACHE_WRITE_USD_PER_MILLION,
  outputUsdPerMillion: CHEAPER_INFERENCE_GEMINI_31_PRO_OUTPUT_USD_PER_MILLION,
  grossMargin: CHEAPER_INFERENCE_GEMINI_31_PRO_GROSS_MARGIN,
};

const CHEAPER_INFERENCE_QWEN_38_MAX_PRICING: ReasoningTokenPricing = {
  modelId: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
  inputUsdPerMillion: CHEAPER_INFERENCE_QWEN_38_MAX_INPUT_USD_PER_MILLION,
  cacheReadUsdPerMillion:
    CHEAPER_INFERENCE_QWEN_38_MAX_CACHED_INPUT_USD_PER_MILLION,
  cacheWriteUsdPerMillion:
    CHEAPER_INFERENCE_QWEN_38_MAX_CACHE_WRITE_USD_PER_MILLION,
  outputUsdPerMillion: CHEAPER_INFERENCE_QWEN_38_MAX_OUTPUT_USD_PER_MILLION,
  grossMargin: CHEAPER_INFERENCE_QWEN_38_MAX_GROSS_MARGIN,
};

function withLiveCheaperInferenceCatalogPricing(
  fallback: ReasoningTokenPricing
): ReasoningTokenPricing {
  const live = resolveCheaperInferenceCatalogPricing(fallback.modelId);
  if (!live) return fallback;
  return {
    ...fallback,
    inputUsdPerMillion: live.inputUsdPerMillion,
    cacheReadUsdPerMillion: live.cacheReadUsdPerMillion,
    cacheWriteUsdPerMillion: live.cacheWriteUsdPerMillion,
    outputUsdPerMillion: live.outputUsdPerMillion,
  };
}

function resolveReasoningTokenPricing(modelId: string): ReasoningTokenPricing | null {
  if (isCheaperInferenceClaudeOpus5Model(modelId)) {
    return CHEAPER_INFERENCE_CLAUDE_OPUS_5_PRICING;
  }
  if (isMuseModel(modelId)) return MUSE_PRICING;
  if (isCheaperInferenceDeepSeekV4ProModel(modelId)) {
    return withLiveCheaperInferenceCatalogPricing(
      CHEAPER_INFERENCE_DEEPSEEK_PRICING
    );
  }
  if (isCheaperInferenceDeepSeekV4FlashModel(modelId)) {
    return withLiveCheaperInferenceCatalogPricing(
      CHEAPER_INFERENCE_DEEPSEEK_FLASH_PRICING
    );
  }
  if (isDeepSeekV4ProModel(modelId)) return DEEPSEEK_PRICING;
  if (isGemini36FlashModel(modelId)) return GEMINI_36_PRICING;
  if (isGpt56TerraModel(modelId)) {
    return withLiveCheaperInferenceCatalogPricing(
      CHEAPER_INFERENCE_TERRA_PRICING
    );
  }
  if (isGpt56LunaModel(modelId)) {
    return withLiveCheaperInferenceCatalogPricing(CHEAPER_INFERENCE_LUNA_PRICING);
  }
  if (isCheaperInferenceGemini31ProModel(modelId)) {
    return withLiveCheaperInferenceCatalogPricing(
      CHEAPER_INFERENCE_GEMINI_31_PRO_PRICING
    );
  }
  if (isCheaperInferenceQwen38MaxModel(modelId)) {
    return withLiveCheaperInferenceCatalogPricing(
      CHEAPER_INFERENCE_QWEN_38_MAX_PRICING
    );
  }
  return null;
}

function isUnifiedReasoningTokenModel(modelId: string): boolean {
  return resolveReasoningTokenPricing(modelId) != null;
}

/**
 * Pure input/output-token billing.
 *
 * sale points/token = ($ list price / 1M) × effective KRW/USD ÷ (1 - margin)
 *
 * API completion totals are authoritative and already contain hidden thinking.
 * There is no cache discount, context surcharge, character floor, note
 * multiplier, or fixed-turn override.
 */
export function resolveOpenRouterReasoningPointRates(
  modelId: string,
  effectiveKrwPerUsd = getEffectiveKrwPerUsd()
): ReasoningPointRates | null {
  const pricing = resolveReasoningTokenPricing(modelId);
  if (!pricing) return null;
  const divisor = 1 - pricing.grossMargin;
  return {
    ...pricing,
    effectiveKrwPerUsd,
    inputPointsPerToken:
      ((pricing.inputUsdPerMillion / 1_000_000) * effectiveKrwPerUsd) / divisor,
    outputPointsPerToken:
      ((pricing.outputUsdPerMillion / 1_000_000) * effectiveKrwPerUsd) / divisor,
  };
}

const initialDeepSeekRates = resolveOpenRouterReasoningPointRates(
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL
)!;
const initialGemini36Rates = resolveOpenRouterReasoningPointRates(
  OPENROUTER_GEMINI_36_FLASH_MODEL
)!;

export const OPENROUTER_DEEPSEEK_V4_PRO_INPUT_POINTS_PER_TOKEN =
  initialDeepSeekRates.inputPointsPerToken;
export const OPENROUTER_DEEPSEEK_V4_PRO_OUTPUT_POINTS_PER_TOKEN =
  initialDeepSeekRates.outputPointsPerToken;
export const OPENROUTER_GEMINI_36_INPUT_POINTS_PER_TOKEN =
  initialGemini36Rates.inputPointsPerToken;
export const OPENROUTER_GEMINI_36_OUTPUT_POINTS_PER_TOKEN =
  initialGemini36Rates.outputPointsPerToken;

export const OPENROUTER_SIMPLE_POINT_INPUT_PRICES: Record<string, number> = {
  ...core.OPENROUTER_SIMPLE_POINT_INPUT_PRICES,
  [OPENROUTER_DEEPSEEK_V4_PRO_MODEL]:
    OPENROUTER_DEEPSEEK_V4_PRO_INPUT_POINTS_PER_TOKEN,
  [OPENROUTER_GEMINI_36_FLASH_MODEL]:
    OPENROUTER_GEMINI_36_INPUT_POINTS_PER_TOKEN,
};

export const OPENROUTER_SIMPLE_POINT_OUTPUT_PRICES: Record<string, number> = {
  ...core.OPENROUTER_SIMPLE_POINT_OUTPUT_PRICES,
  [OPENROUTER_DEEPSEEK_V4_PRO_MODEL]:
    OPENROUTER_DEEPSEEK_V4_PRO_OUTPUT_POINTS_PER_TOKEN,
  [OPENROUTER_GEMINI_36_FLASH_MODEL]:
    OPENROUTER_GEMINI_36_OUTPUT_POINTS_PER_TOKEN,
};

function ceilFractional(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Number.isInteger(n) ? n : Math.ceil(n - 1e-9);
}

const MARKET_PREVIEW_DIRECT_RATES: Record<
  string,
  { inputUsdPerMillion: number; outputUsdPerMillion: number; grossMargin: number }
> = {
  [CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL]: {
    inputUsdPerMillion: 0.435,
    outputUsdPerMillion: 0.87,
    grossMargin: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_GROSS_MARGIN,
  },
  [CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_LEGACY_MODEL]: {
    inputUsdPerMillion: 0.435,
    outputUsdPerMillion: 0.87,
    grossMargin: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_GROSS_MARGIN,
  },
  [CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL]: {
    inputUsdPerMillion: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_INPUT_USD_PER_MILLION,
    outputUsdPerMillion:
      CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_OUTPUT_USD_PER_MILLION,
    grossMargin: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_GROSS_MARGIN,
  },
  [CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_LEGACY_MODEL]: {
    inputUsdPerMillion: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_INPUT_USD_PER_MILLION,
    outputUsdPerMillion:
      CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_OUTPUT_USD_PER_MILLION,
    grossMargin: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_GROSS_MARGIN,
  },
  [CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL]: {
    inputUsdPerMillion: 2,
    outputUsdPerMillion: 12,
    grossMargin: CHEAPER_INFERENCE_GEMINI_31_PRO_GROSS_MARGIN,
  },
  [CHEAPER_INFERENCE_GPT_56_TERRA_MODEL]: {
    inputUsdPerMillion: 2.5,
    outputUsdPerMillion: 15,
    grossMargin: CHEAPER_INFERENCE_GPT_56_TERRA_GROSS_MARGIN,
  },
};

/**
 * Stable model-picker estimate for market-priced CheaperInference models.
 * discount=0.15 is the fixed midpoint; 0.30/0 are the stable low/high bounds.
 * Actual turn billing continues to use the live authenticated catalog snapshot.
 */
export function computeCheaperInferenceMarketPreviewCost(
  inputTokens: number,
  outputTokens: number,
  modelId: string,
  discount = 0.15
): number | null {
  const pricing = MARKET_PREVIEW_DIRECT_RATES[modelId.trim().toLowerCase()];
  if (!pricing) return null;
  const boundedDiscount = Math.min(0.3, Math.max(0, discount));
  const discountedInput = pricing.inputUsdPerMillion * (1 - boundedDiscount);
  const discountedOutput = pricing.outputUsdPerMillion * (1 - boundedDiscount);
  const rawUsd =
    (Math.max(0, inputTokens) * discountedInput +
      Math.max(0, outputTokens) * discountedOutput) /
    1_000_000;
  return ceilFractional(
    (rawUsd * getEffectiveKrwPerUsd()) / (1 - pricing.grossMargin)
  );
}

function resolveReportedTokens(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : Math.max(0, fallback);
}

type ReasoningPointCost = {
  rawCostKrw: number;
  costPlusMarginKrw: number;
  total: number;
};

function computeReasoningPointCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0
): ReasoningPointCost {
  const rates = resolveOpenRouterReasoningPointRates(modelId);
  if (!rates) return { rawCostKrw: 0, costPlusMarginKrw: 0, total: 0 };
  const input = Math.max(0, inputTokens);
  const completion = Math.max(0, outputTokens) + Math.max(0, reasoningTokens);
  const longContext =
    rates.longContextThresholdTokens != null && input > rates.longContextThresholdTokens;
  const inputUsdPerMillion =
    longContext && rates.longContextInputUsdPerMillion != null
      ? rates.longContextInputUsdPerMillion
      : rates.inputUsdPerMillion;
  const cacheReadUsdPerMillion =
    longContext && rates.longContextCacheReadUsdPerMillion != null
      ? rates.longContextCacheReadUsdPerMillion
      : rates.cacheReadUsdPerMillion ?? inputUsdPerMillion;
  const cacheWriteUsdPerMillion =
    longContext && rates.longContextCacheWriteUsdPerMillion != null
      ? rates.longContextCacheWriteUsdPerMillion
      : rates.cacheWriteUsdPerMillion ?? inputUsdPerMillion;
  const outputUsdPerMillion =
    longContext && rates.longContextOutputUsdPerMillion != null
      ? rates.longContextOutputUsdPerMillion
      : rates.outputUsdPerMillion;
  const cacheRead = Math.min(Math.max(0, cacheReadTokens), input);
  const cacheWrite = Math.min(Math.max(0, cacheWriteTokens), Math.max(0, input - cacheRead));
  const standardInput = Math.max(0, input - cacheRead - cacheWrite);
  const rawCostKrw =
    standardInput * (inputUsdPerMillion / 1_000_000) * rates.effectiveKrwPerUsd +
    cacheRead * (cacheReadUsdPerMillion / 1_000_000) * rates.effectiveKrwPerUsd +
    cacheWrite * (cacheWriteUsdPerMillion / 1_000_000) * rates.effectiveKrwPerUsd +
    completion *
      (outputUsdPerMillion / 1_000_000) *
      rates.effectiveKrwPerUsd;
  const costPlusMarginKrw = rawCostKrw / (1 - rates.grossMargin);
  return {
    rawCostKrw,
    costPlusMarginKrw,
    total: ceilFractional(costPlusMarginKrw),
  };
}

function reasoningCostBreakdown(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number
): ReturnType<typeof core.explainOpenRouterMuseTurnCost> {
  const result = computeReasoningPointCost(
    modelId,
    inputTokens,
    outputTokens,
    reasoningTokens
  );
  return {
    rawCostKrw: result.rawCostKrw,
    charFloorKrw: 0,
    inputSurchargeKrw: 0,
    costPlusMarginKrw: result.costPlusMarginKrw,
    applied: "cost_plus_margin",
    total: result.total,
  };
}

export function computeOpenRouterTurnCost(
  ...args: Parameters<typeof core.computeOpenRouterTurnCost>
): ReturnType<typeof core.computeOpenRouterTurnCost> {
  const [inputTokens, outputTokens, modelId, , opts] = args;
  if (!isUnifiedReasoningTokenModel(modelId ?? "")) {
    return core.computeOpenRouterTurnCost(...args);
  }
  return computeReasoningPointCost(
    modelId ?? "",
    inputTokens,
    outputTokens,
    opts?.reasoningTokens ?? 0
  ).total;
}

export function explainOpenRouterMuseTurnCost(
  ...args: Parameters<typeof core.explainOpenRouterMuseTurnCost>
): ReturnType<typeof core.explainOpenRouterMuseTurnCost> {
  const [inputTokens, outputTokens, modelId, , , reasoningTokens] = args;
  return reasoningCostBreakdown(
    modelId,
    inputTokens,
    outputTokens,
    reasoningTokens ?? 0
  );
}

export function explainOpenRouterDeepSeekTurnCost(
  ...args: Parameters<typeof core.explainOpenRouterDeepSeekTurnCost>
): ReturnType<typeof core.explainOpenRouterDeepSeekTurnCost> {
  const [inputTokens, outputTokens, modelId, , reasoningTokens] = args;
  return reasoningCostBreakdown(
    modelId,
    inputTokens,
    outputTokens,
    reasoningTokens ?? 0
  );
}

export function explainOpenRouterGemini36TurnCost(
  ...args: Parameters<typeof core.explainOpenRouterGemini36TurnCost>
): ReturnType<typeof core.explainOpenRouterGemini36TurnCost> {
  const [inputTokens, outputTokens, modelId, , , reasoningTokens] = args;
  return reasoningCostBreakdown(
    modelId,
    inputTokens,
    outputTokens,
    reasoningTokens ?? 0
  );
}

export function explainOpenRouterGeminiTurnCost(
  ...args: Parameters<typeof core.explainOpenRouterGeminiTurnCost>
): ReturnType<typeof core.explainOpenRouterGeminiTurnCost> {
  const [inputTokens, outputTokens, modelId] = args;
  if (!isGemini36FlashModel(modelId)) {
    return core.explainOpenRouterGeminiTurnCost(...args);
  }
  return reasoningCostBreakdown(modelId, inputTokens, outputTokens, 0);
}

export function computeOpenRouterTurnBilling(
  opts: Parameters<typeof core.computeOpenRouterTurnBilling>[0]
): ReturnType<typeof core.computeOpenRouterTurnBilling> {
  if (!isUnifiedReasoningTokenModel(opts.modelId)) {
    return core.computeOpenRouterTurnBilling(opts);
  }

  const cacheReadTokens = Math.max(0, opts.cacheReadTokens ?? 0);
  const cacheWriteTokens = Math.max(0, opts.cacheWriteTokens ?? 0);
  const billedInputTokens = resolveReportedTokens(
    opts.apiPromptTokens,
    opts.inputTokens
  );
  const billedCompletionTokens = resolveReportedTokens(
    opts.apiCompletionTokens,
    opts.outputTokens + (opts.reasoningTokens ?? 0)
  );
  const rates = resolveOpenRouterReasoningPointRates(opts.modelId);
  const upstreamCostUsd =
    isCheaperInferenceModel(opts.modelId) &&
    typeof opts.upstreamCostUsd === "number" &&
    Number.isFinite(opts.upstreamCostUsd) &&
    opts.upstreamCostUsd > 0
      ? opts.upstreamCostUsd
      : null;
  const baseCost =
    upstreamCostUsd != null && rates
      ? ceilFractional(
          (upstreamCostUsd * rates.effectiveKrwPerUsd) /
            (1 - rates.grossMargin)
        )
      : computeReasoningPointCost(
          opts.modelId,
          billedInputTokens,
          billedCompletionTokens,
          0,
          cacheReadTokens,
          cacheWriteTokens
        ).total;

  return {
    modelId: opts.modelId,
    baseCost,
    contextSurcharge: 0,
    multiplier: 1,
    total: baseCost,
    cacheReadTokens,
    cacheWriteTokens,
    standardInputTokens: Math.max(
      0,
      billedInputTokens - cacheReadTokens - cacheWriteTokens
    ),
  };
}

export function computeTurnBilling(
  opts: Parameters<typeof core.computeTurnBilling>[0]
): ReturnType<typeof core.computeTurnBilling> {
  if (
    opts.provider === "openrouter" ||
    opts.provider === "openai" ||
    opts.provider === "cheaperinference"
  ) {
    const modelId =
      opts.openRouterModelId ??
      (opts.selectedAI ? billingModelId(resolveSelectedAI(opts.selectedAI)) : "");
    if (isUnifiedReasoningTokenModel(modelId)) {
      return computeOpenRouterTurnBilling({
        modelId,
        inputTokens: opts.inputTokens,
        outputTokens: opts.outputTokens,
        reasoningTokens: opts.reasoningTokens,
        cacheReadTokens: opts.cacheReadTokens,
        cacheWriteTokens: opts.cacheWriteTokens,
        outputChars: opts.savedTextChars,
        userContextChars: opts.userContextChars ?? opts.userContextTokens,
        modelLabel: opts.modelLabel,
        messageCount: (opts.completedTurnsBeforeRequest ?? 0) + 1,
        upstreamCostUsd: opts.upstreamCostUsd,
        apiPromptTokens: opts.apiPromptTokens,
        apiCompletionTokens: opts.apiCompletionTokens,
      });
    }
  }
  return core.computeTurnBilling(opts);
}

export * from "./pointsMuse60";

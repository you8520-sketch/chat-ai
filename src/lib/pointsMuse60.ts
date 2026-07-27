import {
  billingModelId,
  isDeepSeekV4ProModel,
  isGemini36FlashModel,
  isMuseModel,
  isTencentHy3Model,
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_TENCENT_HY3_MODEL,
  resolveSelectedAI,
} from "./chatModels";
import { getEffectiveKrwPerUsd } from "./exchangeRate";
import * as core from "./points";

/** OpenRouter public list prices per 1M tokens. */
export const OPENROUTER_MUSE_INPUT_USD_PER_MILLION = 1.25;
export const OPENROUTER_MUSE_OUTPUT_USD_PER_MILLION = 4.25;
export const OPENROUTER_DEEPSEEK_V4_PRO_INPUT_USD_PER_MILLION = 0.435;
export const OPENROUTER_DEEPSEEK_V4_PRO_OUTPUT_USD_PER_MILLION = 0.87;
export const OPENROUTER_TENCENT_HY3_INPUT_USD_PER_MILLION = 0.063;
export const OPENROUTER_TENCENT_HY3_OUTPUT_USD_PER_MILLION = 0.21;
export const OPENROUTER_GEMINI_36_INPUT_USD_PER_MILLION = 1.5;
export const OPENROUTER_GEMINI_36_OUTPUT_USD_PER_MILLION = 7.5;

/** Target gross margins for the user-facing reasoning models. */
export const OPENROUTER_MUSE_GROSS_MARGIN = 0.6;
export const OPENROUTER_DEEPSEEK_V4_PRO_GROSS_MARGIN = 0.65;
export const OPENROUTER_TENCENT_HY3_GROSS_MARGIN = 0.7;
export const OPENROUTER_GEMINI_36_GROSS_MARGIN = 0.5;

type ReasoningTokenPricing = {
  modelId: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  grossMargin: number;
};

export type ReasoningPointRates = ReasoningTokenPricing & {
  effectiveKrwPerUsd: number;
  inputPointsPerToken: number;
  outputPointsPerToken: number;
};

const REASONING_TOKEN_PRICING: readonly ReasoningTokenPricing[] = [
  {
    modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
    inputUsdPerMillion: OPENROUTER_MUSE_INPUT_USD_PER_MILLION,
    outputUsdPerMillion: OPENROUTER_MUSE_OUTPUT_USD_PER_MILLION,
    grossMargin: OPENROUTER_MUSE_GROSS_MARGIN,
  },
  {
    modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    inputUsdPerMillion: OPENROUTER_DEEPSEEK_V4_PRO_INPUT_USD_PER_MILLION,
    outputUsdPerMillion: OPENROUTER_DEEPSEEK_V4_PRO_OUTPUT_USD_PER_MILLION,
    grossMargin: OPENROUTER_DEEPSEEK_V4_PRO_GROSS_MARGIN,
  },
  {
    modelId: OPENROUTER_TENCENT_HY3_MODEL,
    inputUsdPerMillion: OPENROUTER_TENCENT_HY3_INPUT_USD_PER_MILLION,
    outputUsdPerMillion: OPENROUTER_TENCENT_HY3_OUTPUT_USD_PER_MILLION,
    grossMargin: OPENROUTER_TENCENT_HY3_GROSS_MARGIN,
  },
  {
    modelId: OPENROUTER_GEMINI_36_FLASH_MODEL,
    inputUsdPerMillion: OPENROUTER_GEMINI_36_INPUT_USD_PER_MILLION,
    outputUsdPerMillion: OPENROUTER_GEMINI_36_OUTPUT_USD_PER_MILLION,
    grossMargin: OPENROUTER_GEMINI_36_GROSS_MARGIN,
  },
] as const;

function resolveReasoningTokenPricing(modelId: string): ReasoningTokenPricing | null {
  if (isMuseModel(modelId)) return REASONING_TOKEN_PRICING[0];
  if (isDeepSeekV4ProModel(modelId)) return REASONING_TOKEN_PRICING[1];
  if (isTencentHy3Model(modelId)) return REASONING_TOKEN_PRICING[2];
  if (isGemini36FlashModel(modelId)) return REASONING_TOKEN_PRICING[3];
  return null;
}

function isUnifiedReasoningTokenModel(modelId: string): boolean {
  return resolveReasoningTokenPricing(modelId) != null;
}

/**
 * Pure input/output token rates for reasoning models.
 *
 * Formula:
 *   token raw cost in KRW = USD list price / 1,000,000 × effective USD/KRW
 *   sale price = raw cost / (1 - target gross margin)
 *
 * No cache discount, large-context surcharge, character floor, user-note
 * multiplier, or fixed-turn price is applied. API completion totals already
 * contain hidden thinking/reasoning tokens and are therefore never doubled.
 */
export function resolveOpenRouterReasoningPointRates(
  modelId: string,
  effectiveKrwPerUsd = getEffectiveKrwPerUsd()
): ReasoningPointRates | null {
  const pricing = resolveReasoningTokenPricing(modelId);
  if (!pricing) return null;
  const marginDivisor = 1 - pricing.grossMargin;
  return {
    ...pricing,
    effectiveKrwPerUsd,
    inputPointsPerToken:
      ((pricing.inputUsdPerMillion / 1_000_000) * effectiveKrwPerUsd) /
      marginDivisor,
    outputPointsPerToken:
      ((pricing.outputUsdPerMillion / 1_000_000) * effectiveKrwPerUsd) /
      marginDivisor,
  };
}

/** Backward-compatible Muse-specific rate resolver. */
export function resolveOpenRouterMusePointRates(
  effectiveKrwPerUsd = getEffectiveKrwPerUsd()
): ReasoningPointRates {
  return resolveOpenRouterReasoningPointRates(
    OPENROUTER_MUSE_SPARK_11_MODEL,
    effectiveKrwPerUsd
  )!;
}

const initialMuseRates = resolveOpenRouterMusePointRates();
const initialDeepSeekRates = resolveOpenRouterReasoningPointRates(
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL
)!;
const initialHy3Rates = resolveOpenRouterReasoningPointRates(
  OPENROUTER_TENCENT_HY3_MODEL
)!;
const initialGemini36Rates = resolveOpenRouterReasoningPointRates(
  OPENROUTER_GEMINI_36_FLASH_MODEL
)!;

/** Current-process snapshots for tables and diagnostics. Billing resolves per call. */
export const OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN =
  initialMuseRates.inputPointsPerToken;
export const OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN =
  initialMuseRates.outputPointsPerToken;
export const OPENROUTER_DEEPSEEK_V4_PRO_INPUT_POINTS_PER_TOKEN =
  initialDeepSeekRates.inputPointsPerToken;
export const OPENROUTER_DEEPSEEK_V4_PRO_OUTPUT_POINTS_PER_TOKEN =
  initialDeepSeekRates.outputPointsPerToken;
export const OPENROUTER_TENCENT_HY3_INPUT_POINTS_PER_TOKEN =
  initialHy3Rates.inputPointsPerToken;
export const OPENROUTER_TENCENT_HY3_OUTPUT_POINTS_PER_TOKEN =
  initialHy3Rates.outputPointsPerToken;
export const OPENROUTER_GEMINI_36_INPUT_POINTS_PER_TOKEN =
  initialGemini36Rates.inputPointsPerToken;
export const OPENROUTER_GEMINI_36_OUTPUT_POINTS_PER_TOKEN =
  initialGemini36Rates.outputPointsPerToken;

export const OPENROUTER_SIMPLE_POINT_INPUT_PRICES: Record<string, number> = {
  ...core.OPENROUTER_SIMPLE_POINT_INPUT_PRICES,
  [OPENROUTER_MUSE_SPARK_11_MODEL]: OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN,
  [OPENROUTER_DEEPSEEK_V4_PRO_MODEL]:
    OPENROUTER_DEEPSEEK_V4_PRO_INPUT_POINTS_PER_TOKEN,
  [OPENROUTER_TENCENT_HY3_MODEL]: OPENROUTER_TENCENT_HY3_INPUT_POINTS_PER_TOKEN,
  [OPENROUTER_GEMINI_36_FLASH_MODEL]:
    OPENROUTER_GEMINI_36_INPUT_POINTS_PER_TOKEN,
};

export const OPENROUTER_SIMPLE_POINT_OUTPUT_PRICES: Record<string, number> = {
  ...core.OPENROUTER_SIMPLE_POINT_OUTPUT_PRICES,
  [OPENROUTER_MUSE_SPARK_11_MODEL]: OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN,
  [OPENROUTER_DEEPSEEK_V4_PRO_MODEL]:
    OPENROUTER_DEEPSEEK_V4_PRO_OUTPUT_POINTS_PER_TOKEN,
  [OPENROUTER_TENCENT_HY3_MODEL]: OPENROUTER_TENCENT_HY3_OUTPUT_POINTS_PER_TOKEN,
  [OPENROUTER_GEMINI_36_FLASH_MODEL]:
    OPENROUTER_GEMINI_36_OUTPUT_POINTS_PER_TOKEN,
};

function ceilFractional(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Number.isInteger(n) ? n : Math.ceil(n - 1e-9);
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
  reasoningTokens: number
): ReasoningPointCost {
  const rates = resolveOpenRouterReasoningPointRates(modelId);
  if (!rates) return { rawCostKrw: 0, costPlusMarginKrw: 0, total: 0 };
  const input = Math.max(0, inputTokens);
  const output = Math.max(0, outputTokens);
  const reasoning = Math.max(0, reasoningTokens);
  const rawInputCostKrw =
    input * (rates.inputUsdPerMillion / 1_000_000) * rates.effectiveKrwPerUsd;
  const rawOutputCostKrw =
    (output + reasoning) *
    (rates.outputUsdPerMillion / 1_000_000) *
    rates.effectiveKrwPerUsd;
  const rawCostKrw = rawInputCostKrw + rawOutputCostKrw;
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

export function explainOpenRouterTencentHy3TurnCost(
  ...args: Parameters<typeof core.explainOpenRouterTencentHy3TurnCost>
): ReturnType<typeof core.explainOpenRouterTencentHy3TurnCost> {
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

  // API totals are authoritative when present. OpenRouter completion totals
  // already include hidden thinking/reasoning tokens, so reasoning is not added
  // a second time when apiCompletionTokens is available.
  const billedInputTokens = resolveReportedTokens(
    opts.apiPromptTokens,
    opts.inputTokens
  );
  const billedOutputTokens = resolveReportedTokens(
    opts.apiCompletionTokens,
    opts.outputTokens + (opts.reasoningTokens ?? 0)
  );
  const baseCost = computeReasoningPointCost(
    opts.modelId,
    billedInputTokens,
    billedOutputTokens,
    0
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
  if (opts.provider === "openrouter") {
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

export * from "./points";

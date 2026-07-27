import {
  billingModelId,
  isMuseModel,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  resolveSelectedAI,
} from "./chatModels";
import { getEffectiveKrwPerUsd } from "./exchangeRate";
import * as core from "./points";

/** OpenRouter public list prices for Muse Spark 1.1. */
export const OPENROUTER_MUSE_INPUT_USD_PER_MILLION = 1.25;
export const OPENROUTER_MUSE_OUTPUT_USD_PER_MILLION = 4.25;
export const OPENROUTER_MUSE_GROSS_MARGIN = 0.6;

type MusePointRates = {
  effectiveKrwPerUsd: number;
  inputPointsPerToken: number;
  outputPointsPerToken: number;
};

/**
 * Muse Spark 1.1 point rates.
 *
 * Formula:
 *   token raw cost in KRW = USD list price / 1,000,000 × effective USD/KRW
 *   sale price = raw cost / (1 - 0.60)
 *
 * No cache discount, context surcharge, character floor, or fixed-turn price is
 * applied. Thinking tokens use the same rate as output tokens.
 */
export function resolveOpenRouterMusePointRates(
  effectiveKrwPerUsd = getEffectiveKrwPerUsd()
): MusePointRates {
  const marginDivisor = 1 - OPENROUTER_MUSE_GROSS_MARGIN;
  return {
    effectiveKrwPerUsd,
    inputPointsPerToken:
      ((OPENROUTER_MUSE_INPUT_USD_PER_MILLION / 1_000_000) *
        effectiveKrwPerUsd) /
      marginDivisor,
    outputPointsPerToken:
      ((OPENROUTER_MUSE_OUTPUT_USD_PER_MILLION / 1_000_000) *
        effectiveKrwPerUsd) /
      marginDivisor,
  };
}

const initialMuseRates = resolveOpenRouterMusePointRates();

/** Current-process snapshot for tables and diagnostics. Billing resolves rates per call. */
export const OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN =
  initialMuseRates.inputPointsPerToken;
export const OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN =
  initialMuseRates.outputPointsPerToken;

export const OPENROUTER_SIMPLE_POINT_INPUT_PRICES: Record<string, number> = {
  ...core.OPENROUTER_SIMPLE_POINT_INPUT_PRICES,
  [OPENROUTER_MUSE_SPARK_11_MODEL]: OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN,
};

export const OPENROUTER_SIMPLE_POINT_OUTPUT_PRICES: Record<string, number> = {
  ...core.OPENROUTER_SIMPLE_POINT_OUTPUT_PRICES,
  [OPENROUTER_MUSE_SPARK_11_MODEL]: OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN,
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

type MusePointCost = {
  rawCostKrw: number;
  costPlusMarginKrw: number;
  total: number;
};

function computeMusePointCost(
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number
): MusePointCost {
  const input = Math.max(0, inputTokens);
  const output = Math.max(0, outputTokens);
  const reasoning = Math.max(0, reasoningTokens);
  const rates = resolveOpenRouterMusePointRates();
  const rawInputCostKrw =
    input *
    (OPENROUTER_MUSE_INPUT_USD_PER_MILLION / 1_000_000) *
    rates.effectiveKrwPerUsd;
  const rawOutputCostKrw =
    (output + reasoning) *
    (OPENROUTER_MUSE_OUTPUT_USD_PER_MILLION / 1_000_000) *
    rates.effectiveKrwPerUsd;
  const rawCostKrw = rawInputCostKrw + rawOutputCostKrw;
  const costPlusMarginKrw = rawCostKrw / (1 - OPENROUTER_MUSE_GROSS_MARGIN);
  return {
    rawCostKrw,
    costPlusMarginKrw,
    total: ceilFractional(costPlusMarginKrw),
  };
}

export function computeOpenRouterTurnCost(
  ...args: Parameters<typeof core.computeOpenRouterTurnCost>
): ReturnType<typeof core.computeOpenRouterTurnCost> {
  const [inputTokens, outputTokens, modelId, , opts] = args;
  if (!isMuseModel(modelId ?? "")) {
    return core.computeOpenRouterTurnCost(...args);
  }
  return computeMusePointCost(
    inputTokens,
    outputTokens,
    opts?.reasoningTokens ?? 0
  ).total;
}

export function explainOpenRouterMuseTurnCost(
  ...args: Parameters<typeof core.explainOpenRouterMuseTurnCost>
): ReturnType<typeof core.explainOpenRouterMuseTurnCost> {
  const [inputTokens, outputTokens, , , , reasoningTokens] = args;
  const result = computeMusePointCost(
    inputTokens,
    outputTokens,
    reasoningTokens ?? 0
  );
  return {
    rawCostKrw: result.rawCostKrw,
    charFloorKrw: 0,
    costPlusMarginKrw: result.costPlusMarginKrw,
    applied: "cost_plus_margin",
    total: result.total,
  };
}

export function computeOpenRouterTurnBilling(
  opts: Parameters<typeof core.computeOpenRouterTurnBilling>[0]
): ReturnType<typeof core.computeOpenRouterTurnBilling> {
  if (!isMuseModel(opts.modelId)) {
    return core.computeOpenRouterTurnBilling(opts);
  }

  const cacheReadTokens = Math.max(0, opts.cacheReadTokens ?? 0);
  const cacheWriteTokens = Math.max(0, opts.cacheWriteTokens ?? 0);

  // API totals are the authoritative billing basis when present. OpenRouter's
  // completion total already includes hidden thinking/reasoning tokens, so do
  // not add reasoningTokens again in that case.
  const billedInputTokens = resolveReportedTokens(
    opts.apiPromptTokens,
    opts.inputTokens
  );
  const hasApiCompletionTokens =
    typeof opts.apiCompletionTokens === "number" &&
    Number.isFinite(opts.apiCompletionTokens);
  const billedOutputTokens = resolveReportedTokens(
    opts.apiCompletionTokens,
    opts.outputTokens + (opts.reasoningTokens ?? 0)
  );
  const baseCost = computeMusePointCost(
    billedInputTokens,
    billedOutputTokens,
    hasApiCompletionTokens ? 0 : 0
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
    if (isMuseModel(modelId)) {
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

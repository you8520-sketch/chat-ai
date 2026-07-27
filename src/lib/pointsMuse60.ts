import {
  billingModelId,
  isMuseModel,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  resolveSelectedAI,
} from "./chatModels";
import * as core from "./points";

/**
 * Muse Spark 1.1 — 60% gross-margin point rates.
 *
 * OpenRouter list price basis at ₩1,530/USD:
 * - input:  $1.25/M → 0.0048P/token
 * - output: $4.25/M → 0.0163P/token
 *
 * Thinking uses the same rate as output. Token aggregation is intentionally
 * unchanged; this module changes only the Muse per-token point rates.
 */
export const OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN = 0.0048;
export const OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN = 0.0163;

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

function computeMusePointCost(
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number
): number {
  const input = Math.max(0, inputTokens);
  const output = Math.max(0, outputTokens);
  const reasoning = Math.max(0, reasoningTokens);
  const inputTokenCost = input * OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN;
  const inputSurcharge =
    input >= core.OPENROUTER_INPUT_SURCHARGE_THRESHOLD_TOKENS
      ? (input / 1000) * core.OPENROUTER_SIMPLE_POINT_INPUT_SURCHARGE_PER_1000
      : 0;
  const outputTokenCost =
    (output + reasoning) * OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN;
  return ceilFractional(inputTokenCost + inputSurcharge + outputTokenCost);
}

export function computeOpenRouterTurnCost(
  ...args: Parameters<typeof core.computeOpenRouterTurnCost>
): ReturnType<typeof core.computeOpenRouterTurnCost> {
  const [inputTokens, outputTokens, modelId, , opts] = args;
  if (!isMuseModel(modelId ?? "") || process.env.OPENROUTER_BILLING_MODE === "fixed") {
    return core.computeOpenRouterTurnCost(...args);
  }
  return computeMusePointCost(
    inputTokens,
    outputTokens,
    opts?.reasoningTokens ?? 0
  );
}

export function explainOpenRouterMuseTurnCost(
  ...args: Parameters<typeof core.explainOpenRouterMuseTurnCost>
): ReturnType<typeof core.explainOpenRouterMuseTurnCost> {
  const [inputTokens, outputTokens, , , , reasoningTokens] = args;
  const total = computeMusePointCost(
    inputTokens,
    outputTokens,
    reasoningTokens ?? 0
  );
  return {
    rawCostKrw: 0,
    charFloorKrw: 0,
    costPlusMarginKrw: 0,
    applied: "cost_plus_margin",
    total,
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
  const baseCost = computeOpenRouterTurnCost(
    opts.inputTokens,
    opts.outputTokens,
    opts.modelId,
    { cacheReadTokens, cacheWriteTokens },
    {
      outputChars: opts.outputChars,
      reasoningTokens: opts.reasoningTokens,
    }
  );

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
      opts.inputTokens - cacheReadTokens - cacheWriteTokens
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

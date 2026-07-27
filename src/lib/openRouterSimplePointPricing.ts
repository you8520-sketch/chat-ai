import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_TENCENT_HY3_MODEL,
} from "./chatModels";
import { getEffectiveKrwPerUsd } from "./exchangeRate";
import { resolveOpenRouterModelRates } from "./openRouterModelPricing";

export const OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN = 0.0048;
export const OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN = 0.0163;

export const OPENROUTER_SIMPLE_POINT_GROSS_MARGINS: Readonly<Record<string, number>> = {
  [OPENROUTER_DEEPSEEK_V4_PRO_MODEL]: 0.65,
  [OPENROUTER_TENCENT_HY3_MODEL]: 0.7,
  [OPENROUTER_GEMINI_36_FLASH_MODEL]: 0.5,
  [OPENROUTER_MUSE_SPARK_11_MODEL]: 0.6,
};

export type OpenRouterSimplePointPrices = {
  inputPointsPerToken: number;
  outputPointsPerToken: number;
  grossMargin: number;
  effectiveKrwPerUsd: number;
};

/**
 * Resolve point sale prices from the central OpenRouter USD/M rate table.
 *
 * One point is one KRW. Dynamic models use the effective billing exchange rate
 * (including the overseas-card fee), while Muse retains its explicitly agreed
 * fixed rates.
 */
export function resolveOpenRouterSimplePointPrices(
  modelId: string,
  effectiveKrwPerUsd = getEffectiveKrwPerUsd()
): OpenRouterSimplePointPrices | null {
  const id = modelId.trim().toLowerCase();
  const grossMargin = OPENROUTER_SIMPLE_POINT_GROSS_MARGINS[id];
  if (grossMargin == null) return null;

  if (id === OPENROUTER_MUSE_SPARK_11_MODEL) {
    return {
      inputPointsPerToken: OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN,
      outputPointsPerToken: OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN,
      grossMargin,
      effectiveKrwPerUsd,
    };
  }

  if (!Number.isFinite(effectiveKrwPerUsd) || effectiveKrwPerUsd <= 0) {
    return null;
  }

  const rates = resolveOpenRouterModelRates(id);
  const salePriceDivisor = 1_000_000 * (1 - grossMargin);
  return {
    inputPointsPerToken:
      (rates.inputUsdPerM * effectiveKrwPerUsd) / salePriceDivisor,
    outputPointsPerToken:
      (rates.outputUsdPerM * effectiveKrwPerUsd) / salePriceDivisor,
    grossMargin,
    effectiveKrwPerUsd,
  };
}

/**
 * Opus 5.5 live PRODUCT pricing derivation — 35% realized no-cache procurement gross margin.
 * Single numeric owner for catalog values in publishedModelPricing.ts.
 */

export const OPUS55_CI_PROCUREMENT_INPUT_USD_PER_MILLION = 2.8;
export const OPUS55_CI_PROCUREMENT_OUTPUT_USD_PER_MILLION = 14;
export const OPUS55_ANTHROPIC_LIST_INPUT_USD_PER_MILLION = 4;
export const OPUS55_ANTHROPIC_LIST_OUTPUT_USD_PER_MILLION = 20;

/** Commercial decision: CI no-cache procurement gross margin target (not PRODUCT targetMargin). */
export const OPUS55_LIVE_REALIZED_NO_CACHE_PROCUREMENT_GROSS_MARGIN = 0.35;

const PROCUREMENT_TO_LIST_RATIO = OPUS55_CI_PROCUREMENT_INPUT_USD_PER_MILLION / OPUS55_ANTHROPIC_LIST_INPUT_USD_PER_MILLION;

/** Exact: CI procurement = Anthropic list reference × this ratio (input and output). */
export function opus55ProcurementToListRatio(): number {
  return PROCUREMENT_TO_LIST_RATIO;
}

/**
 * Equivalent PRODUCT targetMargin on Anthropic list reference for a realized procurement margin R
 * when procurement = list × k and k is constant across input/output.
 * userCharge = list/(1-m) = k*list/(1-R)  =>  m = 1 - k*(1-R)
 */
export function deriveAnthropicListProductTargetMarginForRealizedProcurementMargin(
  realizedProcurementGrossMargin: number,
  procurementToListRatio: number = PROCUREMENT_TO_LIST_RATIO
): number {
  return 1 - (1 - realizedProcurementGrossMargin) / procurementToListRatio;
}

/**
 * Preferred live representation: effective published reference rates so
 * userCharge = (prompt×inputRef + output×outputRef) with targetMargin 0
 * matches CI procurement / (1 - realizedMargin).
 */
export function deriveOpus55EffectivePublishedReferenceRates(
  realizedProcurementGrossMargin: number = OPUS55_LIVE_REALIZED_NO_CACHE_PROCUREMENT_GROSS_MARGIN
): {
  billingReferenceInputUsdPerMillion: number;
  billingReferenceOutputUsdPerMillion: number;
  targetMargin: 0;
  minimumMarginFloor: 0;
} {
  const divisor = 1 - realizedProcurementGrossMargin;
  return {
    billingReferenceInputUsdPerMillion: OPUS55_CI_PROCUREMENT_INPUT_USD_PER_MILLION / divisor,
    billingReferenceOutputUsdPerMillion: OPUS55_CI_PROCUREMENT_OUTPUT_USD_PER_MILLION / divisor,
    targetMargin: 0,
    minimumMarginFloor: 0,
  };
}

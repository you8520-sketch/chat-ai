import {
  convertUsdToKrw,
  resolveBillingExchangeRateSnapshot,
  type BillingExchangeRateSnapshot,
} from "@/lib/exchangeRate";
import {
  openRouterNormalizedUsdCostFromRates,
  openRouterUsdCostFromRates,
} from "@/lib/openRouterModelPricing";

export type OpenRouterBillingInput = {
  promptTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  modelId?: string;
  /** OpenRouter usage.cost / upstream_inference_cost (USD) */
  upstreamCostUsd?: number;
  /** 과금 시점 환율 스냅샷 — 재계산·표시 일관성 */
  exchangeRate?: Pick<BillingExchangeRateSnapshot, "effectiveKrwPerUsd" | "dateKey" | "mode" | "source">;
};

function roundCost(n: number): number {
  return Math.round(n * 10) / 10;
}

function resolveEffectiveRate(input?: OpenRouterBillingInput["exchangeRate"]): number {
  if (input?.effectiveKrwPerUsd != null && input.effectiveKrwPerUsd > 0) {
    return input.effectiveKrwPerUsd;
  }
  return resolveBillingExchangeRateSnapshot().effectiveKrwPerUsd;
}

/** OpenRouter USD API 원가 — cache read/write 모델별 분리 */
export function openRouterUsdCostDetailed(opts: OpenRouterBillingInput): number {
  if (opts.upstreamCostUsd != null && opts.upstreamCostUsd > 0) {
    return opts.upstreamCostUsd;
  }
  return openRouterUsdCostFromRates(opts).usdCost;
}

/** OpenRouter API 원가 (KRW, 마진 전) — upstream USD 우선, 없으면 토큰 요율 추정 */
export function openRouterRawCostKrw(opts: OpenRouterBillingInput): number {
  const effectiveRate = resolveEffectiveRate(opts.exchangeRate);
  const usd = openRouterUsdCostDetailed(opts);
  return convertUsdToKrw(usd, effectiveRate);
}

/** 과금·마진 산출용 — 영수증 표시와 동일한 원가 베이스 */
export function resolveOpenRouterBillingRawCostKrw(opts: OpenRouterBillingInput): number {
  return openRouterRawCostKrw(opts);
}

/** Opus normalized API 원가 (KRW) — input billed at cache-hit rate */
export function openRouterNormalizedRawCostKrw(
  opts: Pick<OpenRouterBillingInput, "promptTokens" | "outputTokens" | "modelId" | "exchangeRate">
): number {
  const effectiveRate = resolveEffectiveRate(opts.exchangeRate);
  const { usdCost } = openRouterNormalizedUsdCostFromRates({
    promptTokens: opts.promptTokens,
    outputTokens: opts.outputTokens,
    modelId: opts.modelId,
  });
  return convertUsdToKrw(usdCost, effectiveRate);
}

export type { BillingExchangeRateSnapshot };

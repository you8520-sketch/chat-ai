/**
 * Claude Opus 5 user pricing — output-length tiers + coarse input surcharge.
 * Per-turn API cost / cache / widget raw cost never enter the user point formula.
 */

import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CLAUDE_OPUS_MODEL,
  CLAUDE_OPUS_MODEL_LEGACY,
} from "@/lib/chatModels";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const OPUS_PRICE_TIER_LT2500 = envInt("OPUS_PRICE_TIER_LT2500", 380);
export const OPUS_PRICE_TIER_2500_3499 = envInt("OPUS_PRICE_TIER_2500_3499", 430);
export const OPUS_PRICE_TIER_3500_4499 = envInt("OPUS_PRICE_TIER_3500_4499", 480);
export const OPUS_PRICE_TIER_4500_5499 = envInt("OPUS_PRICE_TIER_4500_5499", 530);
export const OPUS_PRICE_TIER_5500_6499 = envInt("OPUS_PRICE_TIER_5500_6499", 580);
export const OPUS_PRICE_TIER_6500_PLUS = envInt("OPUS_PRICE_TIER_6500_PLUS", 620);

export const OPUS_INPUT_TIER_40K_60K = envInt("OPUS_INPUT_TIER_40K_60K", 10);
export const OPUS_INPUT_TIER_60K_80K = envInt("OPUS_INPUT_TIER_60K_80K", 20);
export const OPUS_INPUT_TIER_80K_100K = envInt("OPUS_INPUT_TIER_80K_100K", 30);
export const OPUS_INPUT_TIER_100K_PLUS = envInt("OPUS_INPUT_TIER_100K_PLUS", 40);

export const OPUS_MAX_TURN_POINTS = envInt("OPUS_MAX_TURN_POINTS", 620);
export const TARGET_OPUS_GROSS_MARGIN = envFloat(
  "OPUS_TARGET_GROSS_MARGIN",
  envFloat("OPENROUTER_OPUS_GROSS_MARGIN", 0.45)
);

/**
 * LIVE user pricing — Claude Opus 5 only.
 * The 380–620P output-tier table is not inherited by Opus 4.5 or remapped legacy slugs.
 */
export const OPUS_TIER_PRICED_MODEL_IDS = new Set(
  [CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL].map((id) => id.trim().toLowerCase())
);

/**
 * Historical receipt / telemetry ids. Do not use this set for live user pricing.
 * Rolling Opus 5 margin must still filter to claude-opus-5 via isOpus5MarginTelemetryModel().
 */
export const OPUS_HISTORICAL_TELEMETRY_MODEL_IDS = new Set(
  [
    CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    CLAUDE_OPUS_MODEL,
    CLAUDE_OPUS_MODEL_LEGACY,
    "claude-opus",
    "anthropic/claude-opus-latest",
  ].map((id) => id.trim().toLowerCase())
);

export function isOpusTierPricedModel(modelId?: string | null): boolean {
  const id = (modelId ?? "").trim().toLowerCase();
  return id.length > 0 && OPUS_TIER_PRICED_MODEL_IDS.has(id);
}

export function isOpusHistoricalTelemetryModel(modelId?: string | null): boolean {
  const id = (modelId ?? "").trim().toLowerCase();
  return id.length > 0 && OPUS_HISTORICAL_TELEMETRY_MODEL_IDS.has(id);
}

/** Rolling Opus 5 45% margin — never mix Opus 4.5 API cost into this filter. */
export function isOpus5MarginTelemetryModel(modelId?: string | null): boolean {
  return isOpusTierPricedModel(modelId);
}

export function resolveOpusOutputTierPoints(outputChars: number): number {
  const chars = Math.max(0, outputChars);
  if (chars < 2500) return OPUS_PRICE_TIER_LT2500;
  if (chars < 3500) return OPUS_PRICE_TIER_2500_3499;
  if (chars < 4500) return OPUS_PRICE_TIER_3500_4499;
  if (chars < 5500) return OPUS_PRICE_TIER_4500_5499;
  if (chars < 6500) return OPUS_PRICE_TIER_5500_6499;
  return OPUS_PRICE_TIER_6500_PLUS;
}

export function resolveOpusInputSurchargePoints(apiInputTokens: number): number {
  const tokens = Math.max(0, apiInputTokens);
  if (tokens <= 40_000) return 0;
  if (tokens <= 60_000) return OPUS_INPUT_TIER_40K_60K;
  if (tokens <= 80_000) return OPUS_INPUT_TIER_60K_80K;
  if (tokens <= 100_000) return OPUS_INPUT_TIER_80K_100K;
  return OPUS_INPUT_TIER_100K_PLUS;
}

export type OpusUserTurnCharge = {
  outputChars: number;
  outputTierPoints: number;
  inputTokens: number;
  contextSurchargePoints: number;
  uncappedPoints: number;
  finalChargePoints: number;
};

export function resolveOpusUserTurnCharge(opts: {
  outputChars: number;
  apiInputTokens: number;
}): OpusUserTurnCharge {
  const outputChars = Math.max(0, opts.outputChars);
  const inputTokens = Math.max(0, opts.apiInputTokens);
  const outputTierPoints = resolveOpusOutputTierPoints(outputChars);
  const contextSurchargePoints = resolveOpusInputSurchargePoints(inputTokens);
  const uncappedPoints = outputTierPoints + contextSurchargePoints;
  return {
    outputChars,
    outputTierPoints,
    inputTokens,
    contextSurchargePoints,
    uncappedPoints,
    finalChargePoints: Math.min(OPUS_MAX_TURN_POINTS, uncappedPoints),
  };
}

export type OpusPaidTurnTelemetry = {
  deductedPoints: number;
  mainApiRawCostKrw: number;
  widgetApiRawCostKrw: number;
  cacheWriteTokens?: number;
  visibleOutputChars?: number;
  billingWaived?: boolean;
};

export type OpusRollingWindowStats = {
  turns: number;
  totalRevenuePoints: number;
  totalApiCostKrw: number;
  realizedGrossMarginPct: number | null;
  avgChargePerTurn: number | null;
  avgApiCostPerTurn: number | null;
  coldCacheWriteTurnCount: number;
  avgVisibleOutputChars: number | null;
  targetGrossMargin: number;
};

export const OPUS_COLD_CACHE_WRITE_THRESHOLD = 3000;

export function computeOpusRollingGrossMargin(
  turns: OpusPaidTurnTelemetry[],
  window: number
): OpusRollingWindowStats {
  const paid = turns
    .filter((t) => !t.billingWaived && t.deductedPoints > 0)
    .slice(0, Math.max(0, window));
  const totalRevenuePoints = paid.reduce((n, t) => n + t.deductedPoints, 0);
  const totalApiCostKrw = paid.reduce(
    (n, t) => n + Math.max(0, t.mainApiRawCostKrw) + Math.max(0, t.widgetApiRawCostKrw),
    0
  );
  const coldCacheWriteTurnCount = paid.filter(
    (t) => Math.max(0, t.cacheWriteTokens ?? 0) > OPUS_COLD_CACHE_WRITE_THRESHOLD
  ).length;
  const charSum = paid.reduce((n, t) => n + Math.max(0, t.visibleOutputChars ?? 0), 0);
  return {
    turns: paid.length,
    totalRevenuePoints,
    totalApiCostKrw,
    realizedGrossMarginPct:
      totalRevenuePoints > 0
        ? Math.round((1 - totalApiCostKrw / totalRevenuePoints) * 1000) / 10
        : null,
    avgChargePerTurn: paid.length ? Math.round(totalRevenuePoints / paid.length) : null,
    avgApiCostPerTurn: paid.length
      ? Math.round((totalApiCostKrw / paid.length) * 10) / 10
      : null,
    coldCacheWriteTurnCount,
    avgVisibleOutputChars: paid.length ? Math.round(charSum / paid.length) : null,
    targetGrossMargin: TARGET_OPUS_GROSS_MARGIN,
  };
}

export function computeOpusRollingWindows(turns: OpusPaidTurnTelemetry[]): {
  last20: OpusRollingWindowStats;
  last50: OpusRollingWindowStats;
  last100: OpusRollingWindowStats;
} {
  return {
    last20: computeOpusRollingGrossMargin(turns, 20),
    last50: computeOpusRollingGrossMargin(turns, 50),
    last100: computeOpusRollingGrossMargin(turns, 100),
  };
}

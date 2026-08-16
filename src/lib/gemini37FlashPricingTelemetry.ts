import { computeGemini37FlashUserChargePoints } from "@/lib/gemini37FlashPricing";
import { openRouterUsdCostFromRates } from "@/lib/openRouterModelPricing";
import { getEffectiveKrwPerUsd } from "@/lib/exchangeRate";
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } from "@/lib/chatModels";

/**
 * Telemetry-only. Does not change the V3 price table.
 * User P is computed from the frozen V3 formula; cache/upstream never enter P.
 */

export const GEMINI37_LONG_CONTEXT_INPUT_FLOOR = 75_000;
export const GEMINI37_TELEMETRY_MIN_SAMPLES = 20;
export const GEMINI37_UPSTREAM_EXPENSIVE_CATALOG_RATIO = 0.7;

export const GEMINI37_INPUT_BANDS = [
  { id: "le_75k", label: "<=75K", min: 0, max: 75_000 },
  { id: "75_85k", label: "75K-85K", min: 75_001, max: 85_000 },
  { id: "85_95k", label: "85K-95K", min: 85_001, max: 95_000 },
  { id: "95_105k", label: "95K-105K", min: 95_001, max: 105_000 },
  { id: "gt_105k", label: ">105K", min: 105_001, max: Number.POSITIVE_INFINITY },
] as const;

export type Gemini37InputBandId = (typeof GEMINI37_INPUT_BANDS)[number]["id"];

export type Gemini37FlashTelemetryReceipt = {
  id: string;
  apiInputTokens: number;
  billedOutputTokens: number;
  actualApiCostKrw: number;
  deductedPoints?: number | null;
  finishReason?: string | null;
  waived?: boolean;
  streamIncomplete?: boolean;
};

export type Gemini37BandTelemetry = {
  band: string;
  validSampleCount: number;
  revenueP: number;
  rawApiCostKrw: number;
  realizedGrossMarginPct: number | null;
  avgUserP: number | null;
  avgApiInputTokens: number | null;
  avgBilledOutputTokens: number | null;
  cheapUpstreamCount: number;
  expensiveUpstreamCount: number;
};

export type Gemini37RollingTelemetry = {
  window: "last20" | "last50" | "last100" | "all";
  validSampleCount: number;
  revenueP: number;
  rawApiCostKrw: number;
  realizedGrossMarginPct: number | null;
};

export type Gemini37TelemetryVerdict =
  | "V3_PRODUCTION_CANDIDATE"
  | "LONG_CONTEXT_REVIEW"
  | "PRICE_HIGH_REVIEW"
  | "INSUFFICIENT_SAMPLES";

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function realizedGrossMarginPct(
  revenueP: number,
  rawApiCostKrw: number
): number | null {
  if (!(revenueP > 0)) return null;
  return round1((1 - rawApiCostKrw / revenueP) * 100);
}

export function classifyGemini37InputBand(
  apiInputTokens: number
): Gemini37InputBandId {
  const tokens = Math.max(0, Math.round(apiInputTokens) || 0);
  for (const band of GEMINI37_INPUT_BANDS) {
    if (tokens >= band.min && tokens <= band.max) return band.id;
  }
  return "gt_105k";
}

export function catalogApiCostKrw(opts: {
  apiInputTokens: number;
  billedOutputTokens: number;
  krwPerUsd?: number;
}): number {
  const usd = openRouterUsdCostFromRates({
    modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    promptTokens: opts.apiInputTokens,
    outputTokens: opts.billedOutputTokens,
  }).usdCost;
  return usd * (opts.krwPerUsd ?? getEffectiveKrwPerUsd());
}

export function classifyUpstreamCostClass(opts: {
  actualApiCostKrw: number;
  catalogApiCostKrw: number;
}): "cheap" | "expensive" {
  if (
    opts.catalogApiCostKrw > 0 &&
    opts.actualApiCostKrw >=
      opts.catalogApiCostKrw * GEMINI37_UPSTREAM_EXPENSIVE_CATALOG_RATIO
  ) {
    return "expensive";
  }
  return "cheap";
}

export function isValidGemini37PaidReceipt(
  receipt: Gemini37FlashTelemetryReceipt
): boolean {
  if (receipt.waived || receipt.streamIncomplete) return false;
  const finish = String(receipt.finishReason ?? "").trim();
  if (finish.length === 0 && receipt.apiInputTokens === 0 && receipt.billedOutputTokens === 0) {
    return false;
  }
  if (!(receipt.actualApiCostKrw > 0)) return false;
  if (!(receipt.apiInputTokens > 0)) return false;
  return true;
}

function avg(sum: number, n: number): number | null {
  if (n <= 0) return null;
  return round1(sum / n);
}

function emptyBand(label: string): Gemini37BandTelemetry {
  return {
    band: label,
    validSampleCount: 0,
    revenueP: 0,
    rawApiCostKrw: 0,
    realizedGrossMarginPct: null,
    avgUserP: null,
    avgApiInputTokens: null,
    avgBilledOutputTokens: null,
    cheapUpstreamCount: 0,
    expensiveUpstreamCount: 0,
  };
}

export function aggregateGemini37FlashTelemetry(
  receipts: Gemini37FlashTelemetryReceipt[],
  opts?: { krwPerUsd?: number }
): {
  valid: Array<
    Gemini37FlashTelemetryReceipt & {
      v3UserP: number;
      band: Gemini37InputBandId;
      upstreamClass: "cheap" | "expensive";
    }
  >;
  bands: Gemini37BandTelemetry[];
  rolling: Gemini37RollingTelemetry[];
  longContext: {
    turnCount: number;
    turnSharePct: number | null;
    revenueP: number;
    revenueSharePct: number | null;
    rawApiCostKrw: number;
    realizedGrossMarginPct: number | null;
  };
  overall: Gemini37RollingTelemetry;
  verdict: Gemini37TelemetryVerdict;
} {
  const valid = receipts.filter(isValidGemini37PaidReceipt).map((receipt) => {
    const v3UserP = computeGemini37FlashUserChargePoints({
      inputTokens: receipt.apiInputTokens,
      billedOutputTokens: receipt.billedOutputTokens,
    });
    const catalogKrw = catalogApiCostKrw({
      apiInputTokens: receipt.apiInputTokens,
      billedOutputTokens: receipt.billedOutputTokens,
      krwPerUsd: opts?.krwPerUsd,
    });
    return {
      ...receipt,
      v3UserP,
      band: classifyGemini37InputBand(receipt.apiInputTokens),
      upstreamClass: classifyUpstreamCostClass({
        actualApiCostKrw: receipt.actualApiCostKrw,
        catalogApiCostKrw: catalogKrw,
      }),
    };
  });

  const bands = GEMINI37_INPUT_BANDS.map((band) => {
    const rows = valid.filter((row) => row.band === band.id);
    const revenueP = rows.reduce((sum, row) => sum + row.v3UserP, 0);
    const rawApiCostKrw = round3(
      rows.reduce((sum, row) => sum + row.actualApiCostKrw, 0)
    );
    return {
      band: band.label,
      validSampleCount: rows.length,
      revenueP,
      rawApiCostKrw,
      realizedGrossMarginPct: realizedGrossMarginPct(revenueP, rawApiCostKrw),
      avgUserP: avg(revenueP, rows.length),
      avgApiInputTokens: avg(
        rows.reduce((sum, row) => sum + row.apiInputTokens, 0),
        rows.length
      ),
      avgBilledOutputTokens: avg(
        rows.reduce((sum, row) => sum + row.billedOutputTokens, 0),
        rows.length
      ),
      cheapUpstreamCount: rows.filter((row) => row.upstreamClass === "cheap").length,
      expensiveUpstreamCount: rows.filter((row) => row.upstreamClass === "expensive")
        .length,
    } satisfies Gemini37BandTelemetry;
  });

  const roll = (window: Gemini37RollingTelemetry["window"], n?: number) => {
    const rows = n == null ? valid : valid.slice(-n);
    const revenueP = rows.reduce((sum, row) => sum + row.v3UserP, 0);
    const rawApiCostKrw = round3(
      rows.reduce((sum, row) => sum + row.actualApiCostKrw, 0)
    );
    return {
      window,
      validSampleCount: rows.length,
      revenueP,
      rawApiCostKrw,
      realizedGrossMarginPct: realizedGrossMarginPct(revenueP, rawApiCostKrw),
    } satisfies Gemini37RollingTelemetry;
  };

  const overall = roll("all");
  const rolling = [roll("last20", 20), roll("last50", 50), roll("last100", 100), overall];

  const longRows = valid.filter(
    (row) => row.apiInputTokens > GEMINI37_LONG_CONTEXT_INPUT_FLOOR
  );
  const longRevenue = longRows.reduce((sum, row) => sum + row.v3UserP, 0);
  const longCost = round3(
    longRows.reduce((sum, row) => sum + row.actualApiCostKrw, 0)
  );
  const longContext = {
    turnCount: longRows.length,
    turnSharePct:
      valid.length > 0 ? round1((longRows.length / valid.length) * 100) : null,
    revenueP: longRevenue,
    revenueSharePct:
      overall.revenueP > 0 ? round1((longRevenue / overall.revenueP) * 100) : null,
    rawApiCostKrw: longCost,
    realizedGrossMarginPct: realizedGrossMarginPct(longRevenue, longCost),
  };

  return {
    valid,
    bands: bands.length ? bands : GEMINI37_INPUT_BANDS.map((b) => emptyBand(b.label)),
    rolling,
    longContext,
    overall,
    verdict: resolveGemini37TelemetryVerdict({
      overallMarginPct: overall.realizedGrossMarginPct,
      sampleCount: overall.validSampleCount,
      longContextMarginPct: longContext.realizedGrossMarginPct,
      longContextTurnSharePct: longContext.turnSharePct,
    }),
  };
}

export function resolveGemini37TelemetryVerdict(opts: {
  overallMarginPct: number | null;
  sampleCount: number;
  longContextMarginPct: number | null;
  longContextTurnSharePct: number | null;
}): Gemini37TelemetryVerdict {
  if (opts.sampleCount < GEMINI37_TELEMETRY_MIN_SAMPLES) {
    return "INSUFFICIENT_SAMPLES";
  }
  const overall = opts.overallMarginPct;
  if (overall == null) return "INSUFFICIENT_SAMPLES";
  if (overall > 60) return "PRICE_HIGH_REVIEW";
  if (overall >= 55) return "V3_PRODUCTION_CANDIDATE";
  const longShare = opts.longContextTurnSharePct ?? 0;
  const longMargin = opts.longContextMarginPct;
  if (longShare > 0 && (longMargin == null || longMargin < 55)) {
    return "LONG_CONTEXT_REVIEW";
  }
  return "LONG_CONTEXT_REVIEW";
}

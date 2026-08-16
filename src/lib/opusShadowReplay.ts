import {
  OPUS_COLD_CACHE_WRITE_THRESHOLD,
  isOpusTierPricedModel,
  resolveOpusUserTurnCharge,
} from "@/lib/opusTierPricing";
import type { Usage } from "@/lib/chatUsage";

export type OpusShadowTurn = {
  outputChars: number;
  inputTokens: number;
  actualApiCostKrw: number;
  mainApiRawCostKrw: number;
  widgetApiRawCostKrw: number;
  oldChargedPoints: number;
  newShadowPoints: number;
  oldRealizedMarginPct: number | null;
  newShadowRealizedMarginPct: number | null;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  coldWarm: "cold" | "warm";
  hardCapApplied: boolean;
};

export type OpusShadowWindow = {
  sampleTurns: number;
  avgOutputChars: number | null;
  avgInputTokens: number | null;
  avgOldCharge: number | null;
  avgNewCharge: number | null;
  totalApiCost: number;
  totalNewRevenue: number;
  newRealizedGrossMarginPct: number | null;
  coldWriteTurnCount: number;
  p50NewCharge: number | null;
  p90NewCharge: number | null;
  maxNewCharge: number | null;
  availableSampleOnly: boolean;
};

export type OpusShadowVolatility = {
  oldChargeRange: number | null;
  newChargeRange: number | null;
  oldP90MinusP10: number | null;
  newP90MinusP10: number | null;
  oldMaxSingleTurnCharge: number | null;
  newMaxSingleTurnCharge: number | null;
  hardCap620AppliedCount: number;
};

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

function marginPct(revenue: number, cost: number): number | null {
  if (!(revenue > 0)) return null;
  return Math.round((1 - cost / revenue) * 1000) / 10;
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((n, v) => n + v, 0) / values.length;
}

export function usageToOpusShadowTurn(usage: Usage): OpusShadowTurn | null {
  if (!isOpusTierPricedModel(usage.model) && !isOpusTierPricedModel(usage.selectedAI)) {
    return null;
  }
  if (usage.billingWaived || !(usage.cost > 0)) return null;
  const outputChars = finiteNumber(usage.savedOutputChars);
  const inputTokens = finiteNumber(usage.apiInputTokens);
  const mainApiRawCostKrw = finiteNumber(usage.mainApiRawCostKrw);
  const widgetApiRawCostKrw = finiteNumber(usage.statusWidgetExtract?.apiRawCostKrw);
  const cacheReadTokens = finiteNumber(usage.cacheReadTokens);
  const cacheWriteTokens = finiteNumber(usage.cacheWriteTokens);
  if (
    outputChars == null ||
    inputTokens == null ||
    mainApiRawCostKrw == null ||
    widgetApiRawCostKrw == null ||
    cacheReadTokens == null ||
    cacheWriteTokens == null
  ) {
    return null;
  }
  const actualApiCostKrw = Math.max(0, mainApiRawCostKrw) + Math.max(0, widgetApiRawCostKrw);
  const charge = resolveOpusUserTurnCharge({
    outputChars,
    apiInputTokens: inputTokens,
  });
  return {
    outputChars,
    inputTokens,
    actualApiCostKrw,
    mainApiRawCostKrw,
    widgetApiRawCostKrw,
    oldChargedPoints: usage.cost,
    newShadowPoints: charge.finalChargePoints,
    oldRealizedMarginPct: marginPct(usage.cost, actualApiCostKrw),
    newShadowRealizedMarginPct: marginPct(charge.finalChargePoints, actualApiCostKrw),
    cacheReadTokens,
    cacheWriteTokens,
    coldWarm: cacheWriteTokens > OPUS_COLD_CACHE_WRITE_THRESHOLD ? "cold" : "warm",
    hardCapApplied: charge.uncappedPoints > charge.finalChargePoints,
  };
}

export function summarizeOpusShadowWindow(turns: OpusShadowTurn[]): OpusShadowWindow {
  const newCharges = turns.map((t) => t.newShadowPoints);
  const totalApiCost = turns.reduce((n, t) => n + t.actualApiCostKrw, 0);
  const totalNewRevenue = turns.reduce((n, t) => n + t.newShadowPoints, 0);
  return {
    sampleTurns: turns.length,
    avgOutputChars: avg(turns.map((t) => t.outputChars)),
    avgInputTokens: avg(turns.map((t) => t.inputTokens)),
    avgOldCharge: avg(turns.map((t) => t.oldChargedPoints)),
    avgNewCharge: avg(newCharges),
    totalApiCost,
    totalNewRevenue,
    newRealizedGrossMarginPct: marginPct(totalNewRevenue, totalApiCost),
    coldWriteTurnCount: turns.filter((t) => t.coldWarm === "cold").length,
    p50NewCharge: percentile([...newCharges].sort((a, b) => a - b), 0.5),
    p90NewCharge: percentile([...newCharges].sort((a, b) => a - b), 0.9),
    maxNewCharge: newCharges.length ? Math.max(...newCharges) : null,
    availableSampleOnly: turns.length < 20,
  };
}

export function measureOpusShadowVolatility(turns: OpusShadowTurn[]): OpusShadowVolatility {
  const oldCharges = turns.map((t) => t.oldChargedPoints).sort((a, b) => a - b);
  const newCharges = turns.map((t) => t.newShadowPoints).sort((a, b) => a - b);
  return {
    oldChargeRange: oldCharges.length ? oldCharges[oldCharges.length - 1]! - oldCharges[0]! : null,
    newChargeRange: newCharges.length ? newCharges[newCharges.length - 1]! - newCharges[0]! : null,
    oldP90MinusP10:
      oldCharges.length >= 2
        ? (percentile(oldCharges, 0.9) ?? 0) - (percentile(oldCharges, 0.1) ?? 0)
        : null,
    newP90MinusP10:
      newCharges.length >= 2
        ? (percentile(newCharges, 0.9) ?? 0) - (percentile(newCharges, 0.1) ?? 0)
        : null,
    oldMaxSingleTurnCharge: oldCharges.length ? oldCharges[oldCharges.length - 1]! : null,
    newMaxSingleTurnCharge: newCharges.length ? newCharges[newCharges.length - 1]! : null,
    hardCap620AppliedCount: turns.filter((t) => t.hardCapApplied || t.newShadowPoints === 620).length,
  };
}

export function recommendOpusTierAction(marginPctValue: number | null, sampleTurns: number): {
  action: "KEEP" | "PROPOSE_DECREASE" | "PROPOSE_INCREASE" | "AVAILABLE_SAMPLE_ONLY";
  note: string;
} {
  if (sampleTurns < 20 || marginPctValue == null) {
    return {
      action: "AVAILABLE_SAMPLE_ONLY",
      note: "표본이 20턴 미만이므로 45% 달성 여부를 확정하지 않는다.",
    };
  }
  if (marginPctValue > 48) {
    return {
      action: "PROPOSE_DECREASE",
      note: "48% 초과 — 가격 인하 제안만 보고, 자동 수정 금지.",
    };
  }
  if (marginPctValue < 42) {
    return {
      action: "PROPOSE_INCREASE",
      note: "42% 미만 — 부족한 tier 분석 +10/+20P 후보만 제안, 자동 수정 금지.",
    };
  }
  return {
    action: "KEEP",
    note: "42~48% — 현재 tier 그대로 유지.",
  };
}

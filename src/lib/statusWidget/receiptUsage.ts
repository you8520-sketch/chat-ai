import type { TokenUsage } from "@/lib/ai";
import {
  OPENROUTER_DEEPSEEK_V3_MODEL,
  OPENROUTER_GEMINI_25_FLASH_MODEL,
} from "@/lib/chatModels";
import { openRouterRawCostKrw } from "@/lib/billingRawCost";
import type { BillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import type { Usage } from "@/lib/chatUsage";

/** 상태창 추출 전용 — 공용 TokenUsage에 modelId/callCount를 넣지 않는다. */
export type StatusWidgetExtractBillingMeta = {
  modelId: string;
  callCount: number;
};

/** 상태창 추출 API 원가(KRW)를 P로 올림 반영 */
export function statusWidgetApiCostChargePoints(apiRawCostKrw: number): number {
  if (!Number.isFinite(apiRawCostKrw) || apiRawCostKrw <= 0) return 0;
  return Math.ceil(apiRawCostKrw - 1e-9);
}

export type StatusWidgetExtractReceipt = {
  model: string;
  modelLabel: string;
  input: number;
  output: number;
  apiRawCostKrw: number;
  callCount: number;
  upstreamCostUsd?: number;
  estimated?: boolean;
};

function nonNegativeFinite(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** Product path expects 1–4; invalid meta logs once and defends with min 1. */
export function normalizeStatusWidgetExtractCallCount(callCount: unknown): number {
  if (typeof callCount === "number" && Number.isInteger(callCount) && callCount >= 1 && callCount <= 4) {
    return callCount;
  }
  console.warn("[status-widget-receipt] invalid extract callCount; defending with 1", {
    callCount,
  });
  if (typeof callCount === "number" && Number.isFinite(callCount) && callCount > 1) {
    return Math.min(4, Math.max(1, Math.floor(callCount)));
  }
  return 1;
}

export function statusWidgetExtractModelLabel(modelId: string): string {
  const id = modelId.trim();
  const lower = id.toLowerCase();
  if (
    lower === OPENROUTER_GEMINI_25_FLASH_MODEL ||
    lower.includes("gemini-2.5-flash")
  ) {
    return "Google Gemini 2.5 Flash (상태창 추출)";
  }
  if (
    lower === OPENROUTER_DEEPSEEK_V3_MODEL ||
    lower.includes("deepseek-chat-v3-0324")
  ) {
    return "DeepSeek V3 0324 (상태창 추출)";
  }
  return `${id || "unknown"} (상태창 추출)`;
}

export function mergeStatusWidgetExtractUsages(usages: TokenUsage[]): TokenUsage | null {
  if (usages.length === 0) return null;
  let inputTokens = 0;
  let outputTokens = 0;
  let estimated = false;
  let upstreamCostUsd = 0;
  let hasUpstream = false;
  let apiReportedInputTokens = 0;
  let hasApiReported = false;

  for (const u of usages) {
    inputTokens += nonNegativeFinite(u.inputTokens);
    outputTokens += nonNegativeFinite(u.outputTokens);
    if (u.estimated) estimated = true;
    const reported = nonNegativeFinite(u.apiReportedInputTokens);
    if (reported > 0) {
      apiReportedInputTokens += reported;
      hasApiReported = true;
    }
    const upstream = nonNegativeFinite(u.upstreamCostUsd);
    if (upstream > 0) {
      upstreamCostUsd += upstream;
      hasUpstream = true;
    }
  }

  return {
    inputTokens,
    outputTokens,
    estimated,
    ...(hasApiReported ? { apiReportedInputTokens } : {}),
    ...(hasUpstream ? { upstreamCostUsd } : {}),
  };
}

export function buildStatusWidgetExtractReceipt(
  usage: TokenUsage,
  exchangeRate: BillingExchangeRateSnapshot,
  billingMeta: StatusWidgetExtractBillingMeta
): StatusWidgetExtractReceipt {
  const input = usage.apiReportedInputTokens ?? usage.inputTokens;
  const output = usage.outputTokens;
  const modelId = billingMeta.modelId?.trim() || "unknown";
  const callCount = normalizeStatusWidgetExtractCallCount(billingMeta.callCount);
  return {
    model: modelId,
    modelLabel: statusWidgetExtractModelLabel(modelId),
    input,
    output,
    callCount,
    apiRawCostKrw: openRouterRawCostKrw({
      promptTokens: input,
      outputTokens: output,
      modelId,
      upstreamCostUsd: usage.upstreamCostUsd,
      exchangeRate,
    }),
    ...(usage.upstreamCostUsd != null && usage.upstreamCostUsd > 0
      ? { upstreamCostUsd: usage.upstreamCostUsd }
      : {}),
    estimated: usage.estimated,
  };
}

/** 위젯 추출 API 원가(KRW) → P 올림 + 메인 RP 과금과 합산 */
export function applyStatusWidgetBillingCharge(
  record: Usage,
  widgetUsage: TokenUsage,
  exchangeRate: BillingExchangeRateSnapshot,
  mainBillingCost: number,
  billingMeta: StatusWidgetExtractBillingMeta
): { record: Usage; totalCost: number; widgetCostPoints: number } {
  const withReceipt = appendStatusWidgetExtractToUsageRecord(
    record,
    widgetUsage,
    exchangeRate,
    billingMeta
  );
  const widgetCostPoints = statusWidgetApiCostChargePoints(
    withReceipt.statusWidgetExtract!.apiRawCostKrw
  );
  const totalCost = mainBillingCost + widgetCostPoints;
  const stages = withReceipt.stages?.map((s) =>
    s.stage === "상태창 추출" || s.stage.includes("위젯") ? { ...s, cost: widgetCostPoints } : s
  );

  return {
    widgetCostPoints,
    totalCost,
    record: {
      ...withReceipt,
      baseCost: mainBillingCost,
      widgetCostPoints,
      cost: totalCost,
      stages,
      ...(withReceipt.billingWaived && totalCost > 0
        ? { billingWaived: undefined, billingWaiverReason: undefined }
        : {}),
    },
  };
}

/** 관리자·데모 영수증 — 메인 RP 원가와 위젯 추출 원가 분리·합산 */
export function appendStatusWidgetExtractToUsageRecord(
  record: Usage,
  widgetUsage: TokenUsage,
  exchangeRate: BillingExchangeRateSnapshot,
  billingMeta: StatusWidgetExtractBillingMeta
): Usage {
  const widgetReceipt = buildStatusWidgetExtractReceipt(widgetUsage, exchangeRate, billingMeta);
  const mainApiRawCostKrw = record.mainApiRawCostKrw ?? record.apiRawCostKrw ?? 0;
  const totalApiRawCostKrw = mainApiRawCostKrw + widgetReceipt.apiRawCostKrw;

  const widgetIn = widgetReceipt.input;
  const widgetOut = widgetReceipt.output;
  const callCount = widgetReceipt.callCount;

  return {
    ...record,
    mainApiRawCostKrw,
    statusWidgetExtract: widgetReceipt,
    apiRawCostKrw: totalApiRawCostKrw,
    apiInputTokens: (record.apiInputTokens ?? record.input) + widgetIn,
    apiOutputTokens: (record.apiOutputTokens ?? record.output) + widgetOut,
    apiCallCount: (record.apiCallCount ?? 1) + callCount,
    upstreamCostUsd:
      (record.upstreamCostUsd ?? 0) + (widgetReceipt.upstreamCostUsd ?? 0) > 0
        ? (record.upstreamCostUsd ?? 0) + (widgetReceipt.upstreamCostUsd ?? 0)
        : record.upstreamCostUsd,
    stages: [
      ...(record.stages ?? []),
      {
        stage: "상태창 추출",
        model: widgetReceipt.model,
        input: widgetIn,
        output: widgetOut,
        cost: 0,
      },
    ],
    estimated: record.estimated || widgetReceipt.estimated,
  };
}

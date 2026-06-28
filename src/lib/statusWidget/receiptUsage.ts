import type { TokenUsage } from "@/lib/ai";
import { OPENROUTER_DEEPSEEK_V3_MODEL } from "@/lib/chatModels";
import { openRouterRawCostKrw } from "@/lib/billingRawCost";
import type { BillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import type { Usage } from "@/lib/chatUsage";

export type StatusWidgetExtractReceipt = {
  model: string;
  modelLabel: string;
  input: number;
  output: number;
  apiRawCostKrw: number;
  upstreamCostUsd?: number;
  estimated?: boolean;
};

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
    inputTokens += u.inputTokens;
    outputTokens += u.outputTokens;
    if (u.estimated) estimated = true;
    if (u.apiReportedInputTokens != null && u.apiReportedInputTokens > 0) {
      apiReportedInputTokens += u.apiReportedInputTokens;
      hasApiReported = true;
    }
    if (u.upstreamCostUsd != null && u.upstreamCostUsd > 0) {
      upstreamCostUsd += u.upstreamCostUsd;
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
  exchangeRate: BillingExchangeRateSnapshot
): StatusWidgetExtractReceipt {
  const input = usage.apiReportedInputTokens ?? usage.inputTokens;
  const output = usage.outputTokens;
  return {
    model: OPENROUTER_DEEPSEEK_V3_MODEL,
    modelLabel: "DeepSeek V3 (상태창 위젯)",
    input,
    output,
    apiRawCostKrw: openRouterRawCostKrw({
      promptTokens: input,
      outputTokens: output,
      modelId: OPENROUTER_DEEPSEEK_V3_MODEL,
      upstreamCostUsd: usage.upstreamCostUsd,
      exchangeRate,
    }),
    ...(usage.upstreamCostUsd != null && usage.upstreamCostUsd > 0
      ? { upstreamCostUsd: usage.upstreamCostUsd }
      : {}),
    estimated: usage.estimated,
  };
}

/** 관리자·데모 영수증 — 메인 RP 원가와 위젯 V3 원가 분리·합산 */
export function appendStatusWidgetExtractToUsageRecord(
  record: Usage,
  widgetUsage: TokenUsage,
  exchangeRate: BillingExchangeRateSnapshot
): Usage {
  const widgetReceipt = buildStatusWidgetExtractReceipt(widgetUsage, exchangeRate);
  const mainApiRawCostKrw = record.mainApiRawCostKrw ?? record.apiRawCostKrw ?? 0;
  const totalApiRawCostKrw = mainApiRawCostKrw + widgetReceipt.apiRawCostKrw;

  const widgetIn = widgetReceipt.input;
  const widgetOut = widgetReceipt.output;

  return {
    ...record,
    mainApiRawCostKrw,
    statusWidgetExtract: widgetReceipt,
    apiRawCostKrw: totalApiRawCostKrw,
    apiInputTokens: (record.apiInputTokens ?? record.input) + widgetIn,
    apiOutputTokens: (record.apiOutputTokens ?? record.output) + widgetOut,
    apiCallCount: (record.apiCallCount ?? 1) + 1,
    upstreamCostUsd:
      (record.upstreamCostUsd ?? 0) + (widgetReceipt.upstreamCostUsd ?? 0) > 0
        ? (record.upstreamCostUsd ?? 0) + (widgetReceipt.upstreamCostUsd ?? 0)
        : record.upstreamCostUsd,
    stages: [
      ...(record.stages ?? []),
      {
        stage: "상태창 위젯 (V3)",
        model: widgetReceipt.model,
        input: widgetIn,
        output: widgetOut,
        cost: 0,
      },
    ],
    estimated: record.estimated || widgetReceipt.estimated,
  };
}

import {
  buildBillingReceipt,
  formatBillingReceiptText,
  resolveApiRawCostKrw,
  resolveExchangeRateReceiptLabel,
  resolveOpenRouterCacheReceipt,
} from "@/lib/billingDisplay";
import type { Usage } from "@/lib/chatUsage";

/** 관리자 검토용 — 해당 턴 usage JSON → 평문 영수증 */
export function buildMessageReceiptSnapshot(usageRaw: string | null): string {
  if (!usageRaw?.trim()) return "";
  let usage: Usage;
  try {
    usage = JSON.parse(usageRaw) as Usage;
  } catch {
    return "";
  }
  const receipt = buildBillingReceipt(usage);
  if (!receipt) return "";
  const cache = resolveOpenRouterCacheReceipt(usage);
  return formatBillingReceiptText(receipt, {
    route: usage.route,
    breakdown: usage.breakdown,
    apiRawCostKrw: resolveApiRawCostKrw(usage),
    coldStartShieldApplied: usage.coldStartShieldApplied,
    uncappedChargePoints: usage.uncappedChargePoints,
    coldStartCostFloorPoints: usage.coldStartCostFloorPoints,
    cacheReadLine: cache?.cacheReadLine,
    cacheWriteLine: cache?.cacheWriteLine,
    cacheRateSummary: cache?.rateSummary,
    standardInputTokens: cache?.standardInputTokens,
    exchangeRateLabel: resolveExchangeRateReceiptLabel(usage),
    apiReasoningOutputTokens: usage.apiReasoningOutputTokens,
    apiContentOutputTokens: usage.apiContentOutputTokens,
    statusWidgetExtract: usage.statusWidgetExtract,
    mainApiRawCostKrw: usage.mainApiRawCostKrw,
  });
}

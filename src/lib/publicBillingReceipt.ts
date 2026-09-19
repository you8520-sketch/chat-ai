/**
 * Public (user-facing) billing receipt — teapot-style summary only.
 * Admin receipt remains in billingDisplay / adminBillingReceiptV*.
 */

import { buildBillingReceipt, formatPoints } from "@/lib/billingDisplay";
import type { Usage } from "@/lib/chatUsage";

export type PublicBillingReceipt = {
  modelLabel: string;
  responseCharCount: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  billingTypeLabel: string | null;
  siteDiscountPercent: number | null;
  siteDiscountPoints: number | null;
  finalChargePoints: number;
  waived: boolean;
  estimated: boolean;
};

export function resolvePublicBillingTypeLabel(usage: Usage): string | null {
  if (usage.billingWaived) return null;
  if (usage.provider === "cheaperinference" || usage.provider === "openrouter") {
    return "종량제";
  }
  return null;
}

/** Build minimal public receipt from sanitized usage. */
export function buildPublicBillingReceipt(usage: Usage): PublicBillingReceipt | null {
  const receipt = buildBillingReceipt(usage);
  if (!receipt) return null;

  const responseCharCount = Math.max(0, usage.savedOutputChars ?? 0);

  const inputTokens = usage.apiInputTokens ?? usage.input ?? 0;
  const reasoningTokens = Math.max(0, usage.apiReasoningOutputTokens ?? 0);
  const outputTokens =
    usage.apiContentOutputTokens != null
      ? usage.apiContentOutputTokens
      : Math.max(0, (usage.apiOutputTokens ?? usage.output ?? 0) - reasoningTokens);

  const promo = usage.sitePromotion;
  const hasSiteDiscount =
    promo != null && promo.siteDiscountPercent > 0 && promo.siteDiscountPoints > 0;

  return {
    modelLabel: receipt.modelLabel,
    responseCharCount,
    inputTokens,
    outputTokens,
    reasoningTokens,
    billingTypeLabel: resolvePublicBillingTypeLabel(usage),
    siteDiscountPercent: hasSiteDiscount ? promo.siteDiscountPercent : null,
    siteDiscountPoints: hasSiteDiscount ? promo.siteDiscountPoints : null,
    finalChargePoints: receipt.totalCost,
    waived: Boolean(receipt.waived),
    estimated: Boolean(receipt.estimated),
  };
}

export function formatPublicBillingReceiptText(receipt: PublicBillingReceipt): string {
  const lines = [
    `모델: ${receipt.modelLabel}`,
    `응답 글자 수: ${receipt.responseCharCount.toLocaleString()}자`,
    `입력 토큰: ${receipt.inputTokens.toLocaleString()}`,
    `출력 토큰: ${receipt.outputTokens.toLocaleString()}`,
    `추론 토큰: ${receipt.reasoningTokens.toLocaleString()}`,
  ];
  if (receipt.billingTypeLabel) {
    lines.push(`과금 유형: ${receipt.billingTypeLabel}`);
  }
  if (receipt.siteDiscountPercent != null && receipt.siteDiscountPoints != null) {
    lines.push(
      `모델 할인: -${receipt.siteDiscountPercent}% (-${formatPoints(receipt.siteDiscountPoints)} P)`
    );
  }
  if (receipt.waived) {
    lines.push("최종 차감: 0 P (면제)");
  } else {
    lines.push(`최종 차감: ${formatPoints(receipt.finalChargePoints)} P`);
  }
  return lines.join("\n");
}

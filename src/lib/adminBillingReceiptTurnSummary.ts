import type { AdminBillingReceiptV3 } from "@/lib/adminBillingReceiptV3Shared";
import { wholeTurnCoverageLabel } from "@/lib/adminBillingReceiptV3Shared";
import { formatPoints } from "@/lib/billingDisplay";

export const RECEIPT_BASIC_SUMMARY_OWNER = "adminBillingReceiptTurnSummary.ts";

export type AdminReceiptTurnSummary = {
  deductedPoints: number;
  inputTokens: number;
  outputTokens: number;
  marginPercent: number | null;
  marginUnavailableReason: string | null;
};

export function resolveAdminReceiptSettledPoints(receipt: AdminBillingReceiptV3): number {
  const uc = receipt.syncReceipt.userCharge;
  return uc.settledDeductedPoints ?? uc.deductedPoints;
}

/** Turn summary — whole-turn contribution margin, Main RP user-charge tokens. */
export function buildAdminReceiptTurnSummary(receipt: AdminBillingReceiptV3): AdminReceiptTurnSummary {
  const uc = receipt.syncReceipt.userCharge;
  const marginPercent = receipt.wholeTurn.contributionMarginPercent;
  let marginUnavailableReason: string | null = null;
  if (marginPercent == null) {
    marginUnavailableReason =
      receipt.wholeTurn.coverage === "complete"
        ? "Whole-turn contribution margin unavailable"
        : `Status Meta coverage ${wholeTurnCoverageLabel(receipt.wholeTurn.coverage)}`;
  }

  return {
    deductedPoints: resolveAdminReceiptSettledPoints(receipt),
    inputTokens: uc.inputTokens,
    outputTokens: uc.outputTokens,
    marginPercent,
    marginUnavailableReason,
  };
}

export function formatAdminReceiptTurnSummaryLines(
  summary: AdminReceiptTurnSummary,
  opts?: { locale?: "ko" | "en"; includeHeading?: boolean }
): string[] {
  const locale = opts?.locale ?? "ko";
  const includeHeading = opts?.includeHeading !== false;
  if (locale === "en") {
    const lines: string[] = [];
    if (includeHeading) lines.push("[Turn Summary]");
    lines.push(
      `deducted: ${formatPoints(summary.deductedPoints)} P`,
      `input tokens (Main RP): ${summary.inputTokens.toLocaleString()}`,
      `output tokens (Main RP): ${summary.outputTokens.toLocaleString()}`
    );
    if (summary.marginPercent != null) {
      lines.push(`margin: ${summary.marginPercent}%`);
    } else {
      lines.push(`margin: unavailable (${summary.marginUnavailableReason ?? "unknown"})`);
    }
    return lines;
  }

  const lines: string[] = [];
  if (includeHeading) lines.push("[턴 요약]");
  lines.push(
    `실제 차감          ${formatPoints(summary.deductedPoints)} P`,
    `총 입력 토큰 (Main RP)       ${summary.inputTokens.toLocaleString()} tok`,
    `총 출력 토큰 (Main RP)       ${summary.outputTokens.toLocaleString()} tok`
  );
  if (summary.marginPercent != null) {
    lines.push(`실현 마진          ${summary.marginPercent}%`);
  } else {
    lines.push(
      `실현 마진          계산 불가`,
      `                   ${summary.marginUnavailableReason ?? "Whole-turn contribution margin unavailable"}`
    );
  }
  return lines;
}

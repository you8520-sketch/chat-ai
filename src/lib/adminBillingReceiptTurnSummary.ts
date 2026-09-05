import type { AdminBillingReceiptV3 } from "@/lib/adminBillingReceiptV3Shared";
import { formatPoints } from "@/lib/billingDisplay";

export const RECEIPT_BASIC_SUMMARY_OWNER = "adminBillingReceiptTurnSummary.ts";
export const MARGIN_UNAVAILABLE_REASON_OWNER = "adminBillingReceiptTurnSummary.ts";

export type AdminReceiptTurnSummary = {
  deductedPoints: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  outputVisibleChars: number | null;
  marginPercent: number | null;
  marginUnavailableReason: string | null;
};

export function resolveAdminReceiptSettledPoints(receipt: AdminBillingReceiptV3): number | null {
  const sync = receipt.syncReceipt;
  if (sync) {
    const uc = sync.userCharge;
    return uc.settledDeductedPoints ?? uc.deductedPoints;
  }
  const forensic = receipt.forensic;
  if (forensic?.chargeStatus === "charged" || forensic?.chargeStatus === "not_charged") {
    return forensic.chargeEvidenceSettledPoints;
  }
  return null;
}

/** Evidence-based whole-turn margin unavailability — not a single false Status Meta label. */
export function resolveWholeTurnMarginUnavailableReason(
  receipt: AdminBillingReceiptV3
): string {
  const reasons: string[] = [];

  if (!receipt.wholeTurn.mainExact) {
    reasons.push("Main RP 실제 Provider 원가 미확정");
  }

  if (!receipt.wholeTurn.syncExact && !receipt.wholeTurn.syncProvablyNone) {
    reasons.push("동기 플랫폼 비용 미확정");
  }

  switch (receipt.async.coverage) {
    case "unverifiable": {
      const unverifiableFamilies = receipt.async.byFamily
        .filter((family) => family.coverage === "unverifiable")
        .map((family) => family.label);
      if (unverifiableFamilies.length > 0) {
        reasons.push(`Async 비용 검증 불가 (${unverifiableFamilies.join(", ")})`);
      } else {
        reasons.push("Async 비용 검증 불가");
      }
      break;
    }
    case "pending":
      reasons.push("Async 비용 처리 중");
      break;
    case "partial":
      reasons.push("Async 비용 부분 수집");
      break;
    case "complete":
      break;
    default: {
      const _exhaustive: never = receipt.async.coverage;
      return _exhaustive;
    }
  }

  if (reasons.length > 0) {
    return reasons.join(" · ");
  }

  return receipt.wholeTurn.coverage === "complete"
    ? "Whole-turn contribution margin unavailable"
    : "Whole-turn provider cost coverage incomplete";
}

/** Turn summary — whole-turn contribution margin, Main RP user-charge tokens. */
export function buildAdminReceiptTurnSummary(receipt: AdminBillingReceiptV3): AdminReceiptTurnSummary {
  const sync = receipt.syncReceipt;
  const marginPercent = receipt.wholeTurn.contributionMarginPercent;
  let marginUnavailableReason: string | null = null;
  if (marginPercent == null) {
    marginUnavailableReason = resolveWholeTurnMarginUnavailableReason(receipt);
  }

  return {
    deductedPoints: resolveAdminReceiptSettledPoints(receipt),
    inputTokens: sync?.userCharge.inputTokens ?? null,
    outputTokens: sync?.userCharge.outputTokens ?? null,
    outputVisibleChars: receipt.mainRpOutputVisibleChars,
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
      `deducted: ${summary.deductedPoints == null ? "unavailable" : `${formatPoints(summary.deductedPoints)} P`}`,
      `input tokens (Main RP): ${summary.inputTokens == null ? "unavailable" : summary.inputTokens.toLocaleString()}`,
      `output tokens (Main RP): ${summary.outputTokens == null ? "unavailable" : summary.outputTokens.toLocaleString()}`,
      `output chars (Main RP): ${summary.outputVisibleChars == null ? "unavailable" : summary.outputVisibleChars.toLocaleString()}`
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
    `실제 차감          ${summary.deductedPoints == null ? "확인 불가" : `${formatPoints(summary.deductedPoints)} P`}`,
    `총 입력 토큰 (Main RP)       ${summary.inputTokens == null ? "확인 불가" : `${summary.inputTokens.toLocaleString()} tok`}`,
    `총 출력 토큰 (Main RP)       ${summary.outputTokens == null ? "확인 불가" : `${summary.outputTokens.toLocaleString()} tok`}`,
    `출력 글자수 (Main RP)       ${summary.outputVisibleChars == null ? "확인 불가" : `${summary.outputVisibleChars.toLocaleString()}자`}`
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

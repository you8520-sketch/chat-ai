/** Client-safe settlement outcome vocabulary. No DB or ledger imports. */

export type ChatBillingSettlementOutcome =
  | "charged"
  | "waived"
  | "legacy_already_billed"
  | "duplicate_replay"
  | "legacy_malformed"
  | "under_recovered";

export const UNDER_RECOVERED_OUTCOME = "under_recovered" as const;

/** Product delivered; user lots were not charged. Not a cash debt. */
export const UNDER_RECOVERED_BILLING_MESSAGE =
  "응답은 저장되었지만 포인트 정산에 실패했습니다. 추가 생성은 제한됩니다.";

export const UNDER_RECOVERED_GENERATION_BLOCKED_MESSAGE =
  "이전 응답의 포인트 정산이 끝나지 않아 새 생성을 시작할 수 없습니다.";

export function isUnderRecoveredOutcome(outcome: string | null | undefined): boolean {
  return outcome === UNDER_RECOVERED_OUTCOME;
}

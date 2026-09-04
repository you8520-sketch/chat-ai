export type StoredTurnChargeStatus = "charged" | "not_charged" | "unknown" | "pending";

export type StoredTurnChargeEvidenceStatus =
  | "complete"
  | "partial"
  | "conflict"
  | "insufficient";

export type StoredTurnChargeEvidence = {
  status: StoredTurnChargeStatus;
  settledPoints: number | null;
  evidenceStatus: StoredTurnChargeEvidenceStatus;
  violations: string[];
};

/** User-safe billing summary — no provider internals or admin forensic fields. */
export type UserMessageBillingSummary = {
  messageId: number;
  requestId: string | null;
  generationStatus: string;
  chargeStatus: StoredTurnChargeStatus;
  settledPoints: number | null;
  modelLabel: string | null;
};

export function formatStoredTurnChargeStatusLabel(
  status: StoredTurnChargeStatus,
  settledPoints: number | null
): string {
  switch (status) {
    case "charged":
      return settledPoints != null && settledPoints > 0
        ? `차감됨 · ${settledPoints}P`
        : "차감됨";
    case "not_charged":
      return "차감 없음 · 0P";
    case "pending":
      return "정산 확인 중";
    case "unknown":
      return "차감 여부 확인 불가";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

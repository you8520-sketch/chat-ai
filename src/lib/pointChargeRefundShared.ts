export const POINT_CHARGE_REFUND_STATES = [
  "CLAIMED",
  "DISPATCHED",
  "REQUESTED",
  "SUCCEEDED",
  "FAILED",
  "RECONCILIATION_REQUIRED",
] as const;

export type PointChargeRefundState = (typeof POINT_CHARGE_REFUND_STATES)[number];

export function isPointChargeRefundPendingState(
  state: PointChargeRefundState | undefined
): boolean {
  return (
    state === "CLAIMED" ||
    state === "DISPATCHED" ||
    state === "REQUESTED" ||
    state === "RECONCILIATION_REQUIRED"
  );
}

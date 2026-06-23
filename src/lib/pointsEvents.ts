export const POINTS_DEDUCTED_EVENT = "playai:points-deducted";
export const POINTS_REFUNDED_EVENT = "playai:points-refunded";

export type PointsBalanceDetail = {
  remainingPoints: number;
  paidPoints: number;
  freePoints: number;
};

export type PointsDeductedDetail = PointsBalanceDetail & {
  totalPointsCost: number;
};

export type PointsRefundedDetail = PointsBalanceDetail & {
  refundedAmount: number;
};

export function dispatchPointsDeducted(detail: PointsDeductedDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PointsDeductedDetail>(POINTS_DEDUCTED_EVENT, { detail }));
}

export function dispatchPointsRefunded(detail: PointsRefundedDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PointsRefundedDetail>(POINTS_REFUNDED_EVENT, { detail }));
}

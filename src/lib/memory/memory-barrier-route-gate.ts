import type { SummaryBarrierResult } from "@/lib/memory/memory-rolling-summary";

export type SummaryBarrierGateFailure = {
  status: 503;
  body: {
    error: string;
    code: string;
    retryable: boolean;
    billingWaived: boolean;
    pendingRange: string;
  };
};

export type SummaryBarrierGateResult =
  | { proceed: true; summarizedThrough: number }
  | { proceed: false; response: SummaryBarrierGateFailure };

/** @deprecated Main /api/chat no longer blocks on barrier failure — chat proceeds with RAW expansion. */
export function gateChatOnSummaryBarrier(
  barrier: SummaryBarrierResult
): SummaryBarrierGateResult {
  if (barrier.ok) {
    return { proceed: true, summarizedThrough: barrier.summarizedThrough };
  }
  return {
    proceed: false,
    response: {
      status: 503,
      body: {
        error: "장기 기억 동기화가 지연되었습니다. 잠시 후 다시 시도해 주세요.",
        code: barrier.reason,
        retryable: true,
        billingWaived: true,
        pendingRange: barrier.pendingRange,
      },
    },
  };
}

/** 유료 포인트 선물 수수료 */
export const POINT_GIFT_FEE_RATE_PAID = 0.1;
/** 무료 포인트(출석 제외) 선물 수수료 */
export const POINT_GIFT_FEE_RATE_FREE = 0.2;
/** @deprecated POINT_GIFT_FEE_RATE_PAID 사용 — 하위 호환 */
export const POINT_GIFT_FEE_RATE = POINT_GIFT_FEE_RATE_PAID;
export const MIN_POINT_GIFT_AMOUNT = 10;

export type GiftBreakdown = {
  gross: number;
  fee: number;
  net: number;
  paidGross: number;
  freeGross: number;
  paidFee: number;
  freeFee: number;
};

function roundAmount(n: number): number {
  return Math.round(n * 10) / 10;
}
export function giftFeeRateForType(pointType: "PAID" | "FREE"): number {
  return pointType === "PAID" ? POINT_GIFT_FEE_RATE_PAID : POINT_GIFT_FEE_RATE_FREE;
}

/**
 * Mutation-intent idempotency key lifecycle (single ref per gift form — not a
 * parallel state system). The in-flight key is reused while the payload is
 * identical, so a double-click or a retry after a timeout replays instead of
 * double-spending; any change of recipient/amount rotates to a fresh intent.
 */
export type GiftMutationIntent = {
  key: string;
  recipientKey: string;
  gross: number;
};

export function resolveGiftMutationKey(
  prev: GiftMutationIntent | null,
  recipientKey: string,
  gross: number,
  generateKey: () => string
): GiftMutationIntent {
  if (prev && prev.recipientKey === recipientKey && prev.gross === gross) return prev;
  return { key: generateKey(), recipientKey, gross };
}

/** 단일 종류 기준 수수료 (미리보기용). */
export function computeGiftBreakdown(
  grossAmount: number,
  pointType: "PAID" | "FREE" = "PAID"
): GiftBreakdown {
  const gross = roundAmount(grossAmount);
  const rate = giftFeeRateForType(pointType);
  const fee = roundAmount(gross * rate);
  const net = roundAmount(gross - fee);
  const paidGross = pointType === "PAID" ? gross : 0;
  const freeGross = pointType === "FREE" ? gross : 0;
  return {
    gross,
    fee,
    net,
    paidGross,
    freeGross,
    paidFee: pointType === "PAID" ? fee : 0,
    freeFee: pointType === "FREE" ? fee : 0,
  };
}

/**
 * 클라이언트 보유 잔액만으로 수수료 추정.
 * 서버 차감은 만료 임박 → 무료 우선이므로, 만료 정보가 없을 때는 무료→유료 순으로 추정한다.
 */
export function estimateGiftBreakdown(
  grossAmount: number,
  freeAvailable: number,
  paidAvailable: number
): GiftBreakdown {
  const gross = roundAmount(grossAmount);
  let remaining = gross;
  const freeGross = roundAmount(Math.min(Math.max(0, freeAvailable), remaining));
  remaining = roundAmount(remaining - freeGross);
  const paidGross = roundAmount(Math.min(Math.max(0, paidAvailable), remaining));
  const paidFee = roundAmount(paidGross * POINT_GIFT_FEE_RATE_PAID);
  const freeFee = roundAmount(freeGross * POINT_GIFT_FEE_RATE_FREE);
  const fee = roundAmount(paidFee + freeFee);
  const net = roundAmount(gross - fee);
  return { gross, fee, net, paidGross, freeGross, paidFee, freeFee };
}

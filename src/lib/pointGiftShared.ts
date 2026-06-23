/**
 * Client-safe point gift constants and preview math.
 * Server-only gift execution lives in pointGifts.ts.
 */
export const POINT_GIFT_FEE_RATE = 0.1;
export const MIN_POINT_GIFT_AMOUNT = 10;

export type GiftBreakdown = {
  gross: number;
  fee: number;
  net: number;
};

function roundAmount(n: number): number {
  return Math.round(n * 10) / 10;
}

export function computeGiftBreakdown(grossAmount: number): GiftBreakdown {
  const gross = roundAmount(grossAmount);
  const fee = roundAmount(gross * POINT_GIFT_FEE_RATE);
  const net = roundAmount(gross - fee);
  return { gross, fee, net };
}

/** Overseas card fee — single policy owner shared by legacy production and shadow billing. */
export const OVERSEAS_CARD_FEE_PERCENT = 0.02;
export const OVERSEAS_CARD_FEE_RATE = 1 + OVERSEAS_CARD_FEE_PERCENT;

export function applyOverseasCardFee(baseUsdKrw: number): number {
  return baseUsdKrw * OVERSEAS_CARD_FEE_RATE;
}

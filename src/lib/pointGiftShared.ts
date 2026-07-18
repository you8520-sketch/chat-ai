/**
 * Client-safe point gift constants and preview math.
 * Server-only gift execution lives in pointGifts.ts.
 * Prefer importing from pointGiftsShared.ts (canonical).
 */
export {
  POINT_GIFT_FEE_RATE,
  POINT_GIFT_FEE_RATE_PAID,
  POINT_GIFT_FEE_RATE_FREE,
  MIN_POINT_GIFT_AMOUNT,
  computeGiftBreakdown,
  estimateGiftBreakdown,
  giftFeeRateForType,
  type GiftBreakdown,
} from "./pointGiftsShared";

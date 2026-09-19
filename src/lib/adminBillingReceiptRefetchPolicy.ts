import type { AdminBillingReceiptV3 } from "@/lib/adminBillingReceiptV3Shared";

/** Whether an admin receipt may still be collecting async/post-turn provider costs. */
export function adminReceiptNeedsFollowUpFetch(
  receipt: AdminBillingReceiptV3 | null | undefined
): boolean {
  if (!receipt) return false;
  const whole = receipt.wholeTurn.coverage;
  const asyncCoverage = receipt.async.coverage;
  return (
    whole === "pending" ||
    whole === "partial" ||
    asyncCoverage === "pending" ||
    asyncCoverage === "partial"
  );
}

export const ADMIN_RECEIPT_FOLLOW_UP_MAX_ATTEMPTS = 3;
export const ADMIN_RECEIPT_FOLLOW_UP_DELAY_MS = 1500;

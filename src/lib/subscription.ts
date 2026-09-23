import { getDb } from "./db";

export const SUBSCRIPTION_BILLING_UNAVAILABLE_MESSAGE =
  "정기결제 연동이 완료되지 않아 멤버십 구독을 시작하거나 자동 갱신할 수 없습니다.";

/**
 * Existing subscription cancellation remains supported.
 * It only disables future auto-renew intent and never changes the current paid-through date.
 */
export function cancelAutoRenew(userId: number): void {
  getDb().prepare("UPDATE users SET sub_auto_renew=0 WHERE id=?").run(userId);
}

import { getDb } from "./db";
import type { User } from "./auth-types";
import { isSubscribed } from "./auth-types";
import { PLANS, type PlanId, creditPoints } from "./points";
import { upgradeTier } from "./memory/memory-manager";
import { notifyPaymentSuccess } from "./userNotifications";

function lastPointLogId(db: ReturnType<typeof getDb>, userId: number): number {
  const row = db
    .prepare("SELECT id FROM point_logs WHERE user_id=? ORDER BY id DESC LIMIT 1")
    .get(userId) as { id: number } | undefined;
  return row?.id ?? Date.now();
}

export function addOneMonth(from: Date): Date {
  const until = new Date(from);
  until.setMonth(until.getMonth() + 1);
  return until;
}

export function canSubscribe(user: User): { ok: true } | { ok: false; error: string } {
  if (isSubscribed(user)) {
    return {
      ok: false,
      error: "구독 기간이 종료된 후에만 재결제할 수 있습니다. 연장 구매는 지원하지 않습니다.",
    };
  }
  return { ok: true };
}

export function activateSubscription(userId: number, planId: PlanId, autoRenew = true): Date {
  const plan = PLANS[planId];
  const until = addOneMonth(new Date());
  const db = getDb();
  db.prepare("UPDATE users SET sub_until=?, sub_plan=?, sub_auto_renew=? WHERE id=?").run(
    until.toISOString(),
    planId,
    autoRenew ? 1 : 0,
    userId
  );
  creditPoints(userId, plan.points, "FREE", `${plan.label} 멤버십 지급 (₩${plan.price.toLocaleString()})`);
  upgradeTier(userId, planId);
  return until;
}

/** sub_until 만료 + 정기결제 ON 사용자에게 월 1회 자동 결제·포인트 지급 */
export function processDueRenewals(): number {
  const db = getDb();
  const due = db
    .prepare(
      `SELECT id, sub_plan FROM users
       WHERE sub_auto_renew = 1 AND sub_plan IS NOT NULL
         AND sub_until IS NOT NULL AND sub_until <= datetime('now')`
    )
    .all() as { id: number; sub_plan: string }[];

  let count = 0;
  for (const row of due) {
    if (!(row.sub_plan in PLANS)) continue;
    const plan = PLANS[row.sub_plan as PlanId];
    const until = addOneMonth(new Date());
    db.transaction(() => {
      db.prepare("UPDATE users SET sub_until=? WHERE id=?").run(until.toISOString(), row.id);
      creditPoints(row.id, plan.points, "FREE", `${plan.label} 정기결제 (₩${plan.price.toLocaleString()})`);
    })();
    notifyPaymentSuccess(
      db,
      row.id,
      lastPointLogId(db, row.id),
      "결제 완료",
      `${plan.label} 정기결제 (₩${plan.price.toLocaleString()}) — ${plan.points.toLocaleString()}P 지급`
    );
    count++;
  }
  return count;
}

export function cancelAutoRenew(userId: number): void {
  getDb().prepare("UPDATE users SET sub_auto_renew=0 WHERE id=?").run(userId);
}

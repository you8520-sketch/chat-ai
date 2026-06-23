import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { PLANS, type PlanId } from "@/lib/plans";
import {
  activateSubscription,
  canSubscribe,
  processDueRenewals,
} from "@/lib/subscription";
import { notifyPaymentSuccess } from "@/lib/userNotifications";

function lastPointLogId(db: ReturnType<typeof getDb>, userId: number): number {
  const row = db
    .prepare("SELECT id FROM point_logs WHERE user_id=? ORDER BY id DESC LIMIT 1")
    .get(userId) as { id: number } | undefined;
  return row?.id ?? Date.now();
}

// 월 정기결제 구독 (모의 결제 — 실서비스에서는 빌링키·정기결제 연동)
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  processDueRenewals();

  const gate = canSubscribe(user);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 409 });

  const { planId, autoRenew = true } = await req.json();
  if (!(planId in PLANS)) return NextResponse.json({ error: "잘못된 플랜입니다." }, { status: 400 });

  const plan = PLANS[planId as PlanId];
  const until = activateSubscription(user.id, planId as PlanId, autoRenew !== false);

  notifyPaymentSuccess(
    getDb(),
    user.id,
    lastPointLogId(getDb(), user.id),
    "결제 완료",
    `${plan.label} 멤버십 구독 (₩${plan.price.toLocaleString()}) — ${plan.points.toLocaleString()}P 지급`
  );

  return NextResponse.json({
    ok: true,
    plan: planId,
    sub_until: until.toISOString(),
    auto_renew: autoRenew !== false,
  });
}

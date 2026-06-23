import { NextResponse } from "next/server";
import { getSessionUser, isSubscribed } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { PLANS, type PlanId } from "@/lib/plans";
import { cancelAutoRenew } from "@/lib/subscription";
import { notifyPaymentCancel } from "@/lib/userNotifications";

/** 정기결제 해지 — 현재 구독 기간은 유지, 만료 후 자동 갱신 안 함 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isSubscribed(user)) {
    return NextResponse.json({ error: "활성 구독이 없습니다." }, { status: 400 });
  }

  cancelAutoRenew(user.id);

  const planLabel =
    user.sub_plan && user.sub_plan in PLANS
      ? PLANS[user.sub_plan as PlanId].label
      : "멤버십";

  notifyPaymentCancel(
    getDb(),
    user.id,
    Math.floor(Date.now() / 1000),
    "결제 취소",
    `${planLabel} 정기결제가 해지되었습니다. 현재 구독 기간까지는 혜택이 유지됩니다.`
  );

  return NextResponse.json({ ok: true });
}

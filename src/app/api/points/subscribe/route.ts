import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  isPaymentsEnabled,
  PAYMENTS_DISABLED_MESSAGE,
} from "@/lib/portoneConfig";
import { SUBSCRIPTION_BILLING_UNAVAILABLE_MESSAGE } from "@/lib/subscription";

/**
 * Membership subscription is fail-closed until a real recurring-payment owner exists.
 * Do not grant subscription time or points from this route without verified provider payment.
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  if (!isPaymentsEnabled()) {
    return NextResponse.json({ error: PAYMENTS_DISABLED_MESSAGE }, { status: 403 });
  }

  return NextResponse.json(
    { error: SUBSCRIPTION_BILLING_UNAVAILABLE_MESSAGE },
    { status: 503 }
  );
}

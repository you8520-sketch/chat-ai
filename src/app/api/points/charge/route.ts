import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  isPaymentsEnabled,
  PAYMENTS_DISABLED_MESSAGE,
} from "@/lib/portoneConfig";

export const POINT_CHARGE_REQUIRES_VERIFIED_PAYMENT_MESSAGE =
  "포인트 충전은 PortOne 결제 검증 완료 후에만 지급됩니다.";

/**
 * Legacy mock charge endpoint is fail-closed.
 * The only point-purchase writer is the verified PortOne completion path.
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  if (!isPaymentsEnabled()) {
    return NextResponse.json({ error: PAYMENTS_DISABLED_MESSAGE }, { status: 403 });
  }

  return NextResponse.json(
    { error: POINT_CHARGE_REQUIRES_VERIFIED_PAYMENT_MESSAGE },
    { status: 503 }
  );
}

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  isPortOneBrowserConfigured,
  isPortOneServerVerifyConfigured,
  isPaymentsEnabled,
  PAYMENTS_DISABLED_MESSAGE,
} from "@/lib/portoneConfig";
import { createPortoneCheckout } from "@/lib/portoneCheckout";
import { isPointChargePackageId } from "@/lib/plans";
import {
  canAccessPortoneCheckout,
  isPortoneReviewerAccount,
  PORTONE_REVIEWER_PAYMENTS_NOT_READY_MESSAGE,
} from "@/lib/portoneReviewerAccount";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  if (!canAccessPortoneCheckout(user)) {
    return NextResponse.json(
      {
        error: isPortoneReviewerAccount(user)
          ? PORTONE_REVIEWER_PAYMENTS_NOT_READY_MESSAGE
          : PAYMENTS_DISABLED_MESSAGE,
      },
      { status: 403 }
    );
  }

  if (!isPaymentsEnabled() && !isPortoneReviewerAccount(user)) {
    return NextResponse.json({ error: PAYMENTS_DISABLED_MESSAGE }, { status: 403 });
  }

  if (!isPortOneBrowserConfigured()) {
    return NextResponse.json({ error: "PortOne 결제 설정이 없습니다." }, { status: 503 });
  }

  if (!isPortOneServerVerifyConfigured()) {
    return NextResponse.json(
      { error: "PortOne 서버 결제 검증 설정이 없습니다." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const packageId = typeof body.packageId === "string" ? body.packageId : "";
  if (!isPointChargePackageId(packageId)) {
    return NextResponse.json({ error: "잘못된 상품입니다." }, { status: 400 });
  }
  const result = createPortoneCheckout(user.id, packageId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    paymentId: result.paymentId,
    orderName: result.orderName,
    totalAmount: result.totalAmount,
    packageId: result.packageId,
  });
}

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getPortOneBrowserIdentifiers,
  isPortOneBrowserConfigured,
  isPortOneServerVerifyConfigured,
  isPaymentsEnabled,
  PAYMENTS_DISABLED_MESSAGE,
} from "@/lib/portoneConfig";
import { createPortoneCheckout, hasClientPortoneCheckoutOverride } from "@/lib/portoneCheckout";
import { isPointChargePackageId } from "@/lib/plans";
import {
  canAccessPortoneCheckout,
  getPortoneReviewerKgTestCheckoutContext,
  isConfirmedReviewerKgTestChannel,
  isPortoneReviewerAccount,
  PORTONE_REVIEWER_KG_TEST_CHECKOUT_KIND,
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

  const body = await req.json().catch(() => ({}));
  if (hasClientPortoneCheckoutOverride(body)) {
    return NextResponse.json({ error: "상점·채널은 서버에서만 지정합니다." }, { status: 400 });
  }

  const packageId = typeof body.packageId === "string" ? body.packageId : "";
  if (!isPointChargePackageId(packageId)) {
    return NextResponse.json({ error: "잘못된 상품입니다." }, { status: 400 });
  }

  if (isPortoneReviewerAccount(user)) {
    const context = getPortoneReviewerKgTestCheckoutContext();
    if (!context.ok) {
      return NextResponse.json({ error: PORTONE_REVIEWER_PAYMENTS_NOT_READY_MESSAGE }, { status: 403 });
    }

    const result = createPortoneCheckout(user.id, packageId, {
      checkoutKind: PORTONE_REVIEWER_KG_TEST_CHECKOUT_KIND,
      storeId: context.storeId,
      channelKey: context.channelKey,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      paymentId: result.paymentId,
      orderName: result.orderName,
      totalAmount: result.totalAmount,
      packageId: result.packageId,
      storeId: result.storeId,
      channelKey: result.channelKey,
      checkoutKind: result.checkoutKind,
      payMethod: context.payMethod,
    });
  }

  if (!isPaymentsEnabled()) {
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

  const memberIds = getPortOneBrowserIdentifiers();
  if (isConfirmedReviewerKgTestChannel(memberIds)) {
    return NextResponse.json({ error: "일반 회원은 심사 테스트 채널을 사용할 수 없습니다." }, { status: 403 });
  }

  const result = createPortoneCheckout(user.id, packageId, {
    checkoutKind: "standard",
    storeId: memberIds.storeId,
    channelKey: memberIds.channelKey,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    paymentId: result.paymentId,
    orderName: result.orderName,
    totalAmount: result.totalAmount,
    packageId: result.packageId,
    storeId: result.storeId,
    channelKey: result.channelKey,
    checkoutKind: result.checkoutKind,
    payMethod: "CARD" as const,
  });
}

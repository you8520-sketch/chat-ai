import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isPortOneBrowserConfigured } from "@/lib/portoneConfig";
import { createPortoneCheckout } from "@/lib/portoneCheckout";
import type { PointChargePackageId } from "@/lib/plans";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  if (!isPortOneBrowserConfigured()) {
    return NextResponse.json({ error: "PortOne 결제 설정이 없습니다." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const packageId = body.packageId as PointChargePackageId;
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

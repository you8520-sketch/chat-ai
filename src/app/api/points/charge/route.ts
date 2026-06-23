import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isPaymentsEnabled, PAYMENTS_DISABLED_MESSAGE } from "@/lib/portoneConfig";
import { getDb } from "@/lib/db";
import { POINT_CHARGE_PACKAGES_BY_ID, type PointChargePackageId } from "@/lib/plans";
import { getPointBalance } from "@/lib/points";
import { creditPointChargePackage } from "@/lib/pointCharge";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isPaymentsEnabled()) {
    return NextResponse.json({ error: PAYMENTS_DISABLED_MESSAGE }, { status: 403 });
  }
  const { packageId } = await req.json();
  const pkg = POINT_CHARGE_PACKAGES_BY_ID[packageId as PointChargePackageId];
  if (!pkg) return NextResponse.json({ error: "잘못된 상품입니다." }, { status: 400 });

  const db = getDb();
  const { balance } = creditPointChargePackage(db, user.id, packageId as PointChargePackageId);

  return NextResponse.json({
    ok: true,
    points: balance.total,
    paidPoints: balance.paid,
    freePoints: balance.free,
  });
}

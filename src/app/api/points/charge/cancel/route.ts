import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { cancelPointChargeBatch } from "@/lib/chargeCancellation";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const pointLogId = Number(body.pointLogId ?? body.point_log_id);
  if (!pointLogId) {
    return NextResponse.json({ error: "pointLogId가 필요합니다." }, { status: 400 });
  }

  const result = cancelPointChargeBatch(user.id, pointLogId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    points: result.balance.total,
    paidPoints: result.balance.paid,
    freePoints: result.balance.free,
  });
}

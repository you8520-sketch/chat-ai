import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isPortOneServerVerifyConfigured } from "@/lib/portoneConfig";
import { executePointChargeRefund } from "@/lib/pointChargeRefundExecution";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  if (!isPortOneServerVerifyConfigured()) {
    return NextResponse.json(
      { error: "PortOne 서버 환불 검증 설정이 없어 결제 취소를 처리할 수 없습니다." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const pointLogId = Number(body.pointLogId ?? body.point_log_id);
  if (!pointLogId) {
    return NextResponse.json({ error: "pointLogId가 필요합니다." }, { status: 400 });
  }

  const result = await executePointChargeRefund(user.id, pointLogId);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        status: result.status,
        points: result.balance.total,
        paidPoints: result.balance.paid,
        freePoints: result.balance.free,
      },
      { status: 409 }
    );
  }

  const response = {
    ok: true,
    status: result.status,
    message: "message" in result ? result.message : undefined,
    points: result.balance.total,
    paidPoints: result.balance.paid,
    freePoints: result.balance.free,
  };

  return NextResponse.json(response, {
    status: result.status === "refunded" ? 200 : 202,
  });
}

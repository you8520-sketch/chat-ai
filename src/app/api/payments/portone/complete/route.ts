import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getPointBalance } from "@/lib/points";
import { isPaymentsEnabled, PAYMENTS_DISABLED_MESSAGE, isPortOneServerVerifyConfigured } from "@/lib/portoneConfig";
import { getPortoneCheckoutByPaymentId, markPortoneCheckoutPaid } from "@/lib/portoneCheckout";
import { fetchPortOnePayment, isPortOnePaidStatus } from "@/lib/portoneServer";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  if (!isPaymentsEnabled()) {
    return NextResponse.json({ error: PAYMENTS_DISABLED_MESSAGE }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const paymentId = typeof body.paymentId === "string" ? body.paymentId.trim() : "";
  const clientTxId = typeof body.txId === "string" ? body.txId.trim() : "";

  if (!paymentId) {
    return NextResponse.json({ error: "paymentId가 필요합니다." }, { status: 400 });
  }

  const checkout = getPortoneCheckoutByPaymentId(paymentId);
  if (!checkout) {
    return NextResponse.json({ error: "결제 요청을 찾을 수 없습니다." }, { status: 404 });
  }
  if (checkout.user_id !== user.id) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  if (checkout.status === "paid") {
    const balance = getPointBalance(user.id);
    return NextResponse.json({
      ok: true,
      alreadyPaid: true,
      points: balance.total,
      paidPoints: balance.paid,
      freePoints: balance.free,
    });
  }

  if (!isPortOneServerVerifyConfigured()) {
    return NextResponse.json(
      {
        error:
          "서버에 PORTONE_API_SECRET이 설정되지 않았습니다. 포트원 콘솔 V2 시크릿을 .env.local에 추가한 뒤 다시 시도하세요.",
      },
      { status: 503 }
    );
  }

  let portoneTxId = clientTxId;
  try {
    const remote = await fetchPortOnePayment(paymentId);
    if (!remote) {
      return NextResponse.json({ error: "PortOne에서 결제 정보를 찾을 수 없습니다." }, { status: 404 });
    }
    if (!isPortOnePaidStatus(remote.status)) {
      return NextResponse.json(
        { error: `결제가 완료되지 않았습니다. (상태: ${remote.status})` },
        { status: 402 }
      );
    }
    if (remote.totalAmount != null && remote.totalAmount !== checkout.amount) {
      return NextResponse.json({ error: "결제 금액이 일치하지 않습니다." }, { status: 400 });
    }
    if (remote.txId) portoneTxId = remote.txId;
  } catch (e) {
    console.error("[portone/complete] verify failed", e);
    return NextResponse.json({ error: "결제 검증에 실패했습니다." }, { status: 502 });
  }

  const marked = markPortoneCheckoutPaid(paymentId, portoneTxId);
  if (!marked.ok) {
    return NextResponse.json({ error: marked.error }, { status: 400 });
  }

  const balance = getPointBalance(user.id);
  return NextResponse.json({
    ok: true,
    alreadyPaid: marked.alreadyPaid,
    points: balance.total,
    paidPoints: balance.paid,
    freePoints: balance.free,
  });
}

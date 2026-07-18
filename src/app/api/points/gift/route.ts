import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  estimateGiftBreakdown,
  giftPoints,
  PointGiftError,
  POINT_GIFT_FEE_RATE_FREE,
  POINT_GIFT_FEE_RATE_PAID,
  MIN_POINT_GIFT_AMOUNT,
} from "@/lib/pointGifts";
import { getPointBalance } from "@/lib/points";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: { recipientId?: number; recipientNickname?: string; amount?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "선물 금액을 입력해 주세요." }, { status: 400 });
  }

  try {
    const result = giftPoints(user.id, {
      recipientId: body.recipientId != null ? Number(body.recipientId) : undefined,
      recipientNickname: body.recipientNickname,
      amount,
    });

    return NextResponse.json({
      ok: true,
      giftId: result.giftId,
      recipientNickname: result.recipientNickname,
      gross: result.breakdown.gross,
      fee: result.breakdown.fee,
      net: result.breakdown.net,
      paidGross: result.breakdown.paidGross,
      freeGross: result.breakdown.freeGross,
      points: result.senderBalance.total,
      paidPoints: result.senderBalance.paid,
      freePoints: result.senderBalance.free,
    });
  } catch (err) {
    if (err instanceof PointGiftError) {
      const bal = getPointBalance(user.id);
      const status =
        err.code === "INSUFFICIENT_POINTS" || err.code === "INSUFFICIENT_PAID_POINTS"
          ? 402
          : err.code === "RECIPIENT_NOT_FOUND" || err.code === "RECIPIENT_REQUIRED"
            ? 404
            : 400;
      return NextResponse.json(
        {
          error: err.message,
          code: err.code,
          feeRatePaid: POINT_GIFT_FEE_RATE_PAID,
          feeRateFree: POINT_GIFT_FEE_RATE_FREE,
          minAmount: MIN_POINT_GIFT_AMOUNT,
          preview: estimateGiftBreakdown(amount, bal.free, bal.paid),
        },
        { status }
      );
    }
    throw err;
  }
}

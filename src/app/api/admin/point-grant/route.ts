import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import {
  AdminPointGrantError,
  grantFreePointsByAdminSession,
  MAX_ADMIN_FREE_POINT_GRANT,
  MIN_ADMIN_FREE_POINT_GRANT,
} from "@/lib/adminPointGrant";

export async function POST(req: Request) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const amount = Number(body.amount);
  const recipientId =
    body.recipientId != null && body.recipientId !== ""
      ? Number(body.recipientId)
      : undefined;
  const recipientNickname =
    typeof body.recipientNickname === "string" ? body.recipientNickname : undefined;
  const note = typeof body.note === "string" ? body.note : undefined;

  try {
    const result = grantFreePointsByAdminSession(admin.id, {
      recipientId,
      recipientNickname,
      amount,
      note,
    });

    return NextResponse.json({
      ok: true,
      recipientId: result.recipientId,
      recipientNickname: result.recipientNickname,
      amount: result.amount,
      reason: result.reason,
      recipientBalance: result.recipientBalance,
    });
  } catch (err) {
    if (err instanceof AdminPointGrantError) {
      const status =
        err.code === "RECIPIENT_NOT_FOUND" || err.code === "RECIPIENT_REQUIRED" ? 404 : 400;
      return NextResponse.json(
        {
          error: err.message,
          code: err.code,
          minAmount: MIN_ADMIN_FREE_POINT_GRANT,
          maxAmount: MAX_ADMIN_FREE_POINT_GRANT,
        },
        { status }
      );
    }
    throw err;
  }
}

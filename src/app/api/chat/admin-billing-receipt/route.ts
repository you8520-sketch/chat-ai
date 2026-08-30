import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canShowFullBillingReceipt } from "@/lib/billingReceiptAccess";
import { loadAdminBillingReceiptV3ForMessage } from "@/lib/adminBillingReceiptV3Server";

export const dynamic = "force-dynamic";

/** Privileged lazy admin receipt fetch — server-side auth only. */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const db = getDb();
  const adminRow = db
    .prepare("SELECT is_admin FROM users WHERE id = ?")
    .get(user.id) as { is_admin: number } | undefined;

  if (
    !canShowFullBillingReceipt({
      email: user.email,
      is_admin: adminRow?.is_admin ?? 0,
    })
  ) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const url = new URL(req.url);
  const messageId = Number(url.searchParams.get("messageId"));
  if (!messageId || !Number.isFinite(messageId)) {
    return NextResponse.json({ error: "messageId가 필요합니다." }, { status: 400 });
  }

  const result = loadAdminBillingReceiptV3ForMessage({
    userId: user.id,
    messageId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.receipt, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

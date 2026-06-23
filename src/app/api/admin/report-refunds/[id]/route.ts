import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import { reviewReportRefund } from "@/lib/refund";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const { id } = await params;
  const reportRefundId = Number(id);
  if (!Number.isFinite(reportRefundId) || reportRefundId <= 0) {
    return NextResponse.json({ error: "잘못된 신고 ID입니다." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action === "reject" ? "reject" : body.action === "approve" ? "approve" : null;
  if (!action) {
    return NextResponse.json({ error: "action(approve|reject)이 필요합니다." }, { status: 400 });
  }

  const result = reviewReportRefund(
    reportRefundId,
    action,
    typeof body.adminNote === "string" ? body.adminNote : ""
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  return NextResponse.json({
    ok: true,
    balance: result.balance,
  });
}

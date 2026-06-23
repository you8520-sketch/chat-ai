import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import { getDb } from "@/lib/db";
import { reviewBetaFreePointApplication } from "@/lib/betaFreePointApplication";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const { id } = await params;
  const applicationId = Number(id);
  if (!Number.isFinite(applicationId) || applicationId <= 0) {
    return NextResponse.json({ error: "잘못된 신청 ID입니다." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action === "reject" ? "reject" : body.action === "approve" ? "approve" : null;
  if (!action) {
    return NextResponse.json({ error: "action(approve|reject)이 필요합니다." }, { status: 400 });
  }

  const amount =
    body.amount != null && body.amount !== ""
      ? Number(body.amount)
      : undefined;

  const result = reviewBetaFreePointApplication(
    getDb(),
    applicationId,
    admin.id,
    action,
    {
      amount,
      adminNote: typeof body.adminNote === "string" ? body.adminNote : "",
    }
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  return NextResponse.json({ ok: true, rewardAmount: result.rewardAmount });
}

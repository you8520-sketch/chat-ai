import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import { reviewReportedComment } from "@/lib/adminCommentReports";
import { getDb } from "@/lib/db";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminUser();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  const commentId = Number((await params).id);
  if (!Number.isFinite(commentId) || commentId <= 0) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const body = await req.json().catch(() => ({})) as { action?: unknown; note?: unknown };
  if (body.action !== "delete" && body.action !== "restore") {
    return NextResponse.json({ error: "잘못된 처리 방식입니다." }, { status: 400 });
  }
  const result = reviewReportedComment(
    getDb(),
    admin.id,
    commentId,
    body.action,
    typeof body.note === "string" ? body.note.slice(0, 500) : ""
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, banned: result.banned });
}

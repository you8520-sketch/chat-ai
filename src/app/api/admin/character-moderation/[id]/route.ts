import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import { getDb } from "@/lib/db";
import { reviewCharacterListing } from "@/lib/characterModerationAdmin";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteCtx) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "잘못된 캐릭터 ID입니다." }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { action?: string; adminNote?: string };
  const action = body.action === "reject" ? "reject" : body.action === "approve" ? "approve" : null;
  if (!action) {
    return NextResponse.json({ error: "action(approve|reject)이 필요합니다." }, { status: 400 });
  }

  const result = reviewCharacterListing(
    getDb(),
    id,
    admin.id,
    action,
    typeof body.adminNote === "string" ? body.adminNote : ""
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}

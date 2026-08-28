import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { removeWorldBorrow } from "@/lib/worldShares";

type RouteCtx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const borrowId = Number((await ctx.params).id);
  if (!Number.isInteger(borrowId) || borrowId <= 0) {
    return NextResponse.json({ error: "잘못된 ID입니다." }, { status: 400 });
  }

  const result = removeWorldBorrow(user.id, borrowId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

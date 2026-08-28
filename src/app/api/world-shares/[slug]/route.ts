import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getWorldShareBySlug, revokeWorldShare } from "@/lib/worldShares";

type RouteCtx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  const { slug } = await ctx.params;
  const share = getWorldShareBySlug(slug);
  if (!share) {
    return NextResponse.json({ error: "공유 링크를 찾을 수 없습니다." }, { status: 404 });
  }
  if (!share.available) {
    return NextResponse.json({ error: "더 이상 사용할 수 없는 공유 링크입니다." }, { status: 410 });
  }
  return NextResponse.json({ share });
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { slug } = await ctx.params;
  const result = revokeWorldShare(user.id, slug);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}

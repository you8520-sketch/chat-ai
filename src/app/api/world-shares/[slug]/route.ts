import { NextResponse } from "next/server";
import { getWorldShareBySlug } from "@/lib/worldShares";

type RouteCtx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  const { slug } = await ctx.params;
  const share = getWorldShareBySlug(slug);
  if (!share) {
    return NextResponse.json({ error: "공유 링크를 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({
    shareSlug: share.shareSlug,
    name: share.name,
    summary: share.summary,
    content: share.content,
    authorNickname: share.authorNickname,
    createdAt: share.createdAt,
  });
}

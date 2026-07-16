import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createWorldShare } from "@/lib/worldShares";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: RouteCtx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const id = Number((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "잘못된 ID입니다." }, { status: 400 });

  const created = createWorldShare(user.id, id);
  if ("error" in created) {
    return NextResponse.json({ error: created.error }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    shareSlug: created.share.share_slug,
    applyPath: created.applyPath,
  });
}

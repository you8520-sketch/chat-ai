import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { borrowWorldShareToUser } from "@/lib/worldShares";

type RouteCtx = { params: Promise<{ slug: string }> };

export async function POST(_req: Request, ctx: RouteCtx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!user.is_adult) {
    return NextResponse.json(
      { error: "세계관 추가는 성인인증 완료 후 가능합니다." },
      { status: 403 }
    );
  }

  const { slug } = await ctx.params;
  const result = borrowWorldShareToUser(user.id, slug);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  return NextResponse.json({
    ok: true,
    world: result.world,
    borrowId: result.borrow.id,
    alreadyInLibrary: result.alreadyInLibrary,
    message: result.alreadyInLibrary
      ? "이미 라이브러리에 있습니다."
      : "라이브러리에 추가했습니다.",
  });
}

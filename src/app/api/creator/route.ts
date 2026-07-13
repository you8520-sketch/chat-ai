import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { userHasCreatedCharacters } from "@/lib/creatorAccess";
import { exchangeCreatorPoints, getCreatorDashboard } from "@/lib/creatorPoints";
import { CREATOR_PROFILE_HTML_MAX, sanitizeCreatorHtml } from "@/lib/creatorProfileHtml";
function creatorForbidden() {
  return NextResponse.json(
    { error: "캐릭터를 제작한 크리에이터만 이용할 수 있습니다." },
    { status: 403 }
  );
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!userHasCreatedCharacters(user.id)) return creatorForbidden();

  return NextResponse.json({ ok: true, dashboard: getCreatorDashboard(user.id) });
}

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!userHasCreatedCharacters(user.id)) return creatorForbidden();

  const body = await req.json();
  if (body.comments_enabled !== undefined) {
    const enabled = body.comments_enabled ? 1 : 0;
    getDb().prepare("UPDATE users SET creator_comments_enabled=? WHERE id=?").run(enabled, user.id);
    return NextResponse.json({ ok: true, comments_enabled: enabled === 1 });
  }

  if (body.creator_profile_html !== undefined || body.creator_notice_html !== undefined) {
    const existing = getDb()
      .prepare("SELECT creator_profile_html, creator_notice_html FROM users WHERE id=?")
      .get(user.id) as { creator_profile_html: string; creator_notice_html: string } | undefined;
    if (String(body.creator_profile_html ?? "").length > CREATOR_PROFILE_HTML_MAX) {
      return NextResponse.json(
        { error: `크리에이터 소개는 ${CREATOR_PROFILE_HTML_MAX.toLocaleString()}자 이하여야 합니다.` },
        { status: 400 }
      );
    }
    const profileHtml = sanitizeCreatorHtml(
      body.creator_profile_html ?? existing?.creator_profile_html ?? ""
    );
    const noticeHtml =
      body.creator_notice_html === undefined
        ? existing?.creator_notice_html ?? ""
        : sanitizeCreatorHtml(body.creator_notice_html);
    getDb()
      .prepare("UPDATE users SET creator_profile_html=?, creator_notice_html=? WHERE id=?")
      .run(profileHtml, noticeHtml, user.id);
    return NextResponse.json({
      ok: true,
      creator_profile_html: profileHtml,
      creator_notice_html: noticeHtml,
    });
  }

  return NextResponse.json({ error: "변경할 설정이 없습니다." }, { status: 400 });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!userHasCreatedCharacters(user.id)) return creatorForbidden();

  const { amount } = await req.json();
  const parsed = Number(amount);
  if (!parsed || parsed <= 0) {
    return NextResponse.json({ error: "교환할 크리에이터 포인트를 입력하세요." }, { status: 400 });
  }

  try {
    const result = exchangeCreatorPoints(user.id, parsed);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "교환 실패" }, { status: 400 });
  }
}

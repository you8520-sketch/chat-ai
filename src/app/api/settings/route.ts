import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

// 내 설정 변경: 닉네임 / 취향(pref) / 성인 캐릭터 표시(nsfw_on)
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json();
  const db = getDb();

  if (typeof body.nickname === "string") {
    const nick = body.nickname.trim();
    if (!nick || nick.length > 20) {
      return NextResponse.json({ error: "닉네임은 1~20자로 입력하세요." }, { status: 400 });
    }
    db.prepare("UPDATE users SET nickname=? WHERE id=?").run(nick, user.id);
  }

  if (body.pref !== undefined) {
    if (![null, "female", "male"].includes(body.pref)) {
      return NextResponse.json({ error: "잘못된 취향 값입니다." }, { status: 400 });
    }
    db.prepare("UPDATE users SET pref=?, onboarding_completed_at=COALESCE(onboarding_completed_at, datetime('now')) WHERE id=?").run(body.pref, user.id);
  }

  if (body.nsfw_on !== undefined) {
    if (!user.is_adult) {
      return NextResponse.json({ error: "성인인증 후 사용할 수 있습니다.", needVerify: true }, { status: 403 });
    }
    db.prepare("UPDATE users SET nsfw_on=? WHERE id=?").run(body.nsfw_on ? 1 : 0, user.id);
  }

  return NextResponse.json({ ok: true });
}

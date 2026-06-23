import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

/** 글로벌 기본 유저 노트만 관리 (페르소나는 /api/personas) */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const row = getDb()
    .prepare("SELECT user_note FROM users WHERE id=?")
    .get(user.id) as { user_note: string };

  return NextResponse.json({
    userNote: row.user_note ?? "",
    nickname: user.nickname,
  });
}

export async function PUT(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json();
  const userNote = String(body.userNote ?? "").trim();

  getDb().prepare("UPDATE users SET user_note=? WHERE id=?").run(userNote, user.id);

  return NextResponse.json({ ok: true, userNote });
}

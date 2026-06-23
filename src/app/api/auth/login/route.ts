import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";

export async function POST(req: Request) {
  const { email, password } = await req.json();
  const db = getDb();
  const user = db.prepare("SELECT id, pw_hash, google_id FROM users WHERE email = ?").get(email) as
    | { id: number; pw_hash: string; google_id: string | null }
    | undefined;
  if (!user) {
    return NextResponse.json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }
  if (!user.pw_hash && user.google_id) {
    return NextResponse.json(
      { error: "Google 계정으로 가입하셨습니다. Google로 로그인해 주세요." },
      { status: 401 }
    );
  }
  if (!verifyPassword(password, user.pw_hash)) {
    return NextResponse.json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }
  const token = createSession(user.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set("session", token, { httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 3600, path: "/" });
  return res;
}

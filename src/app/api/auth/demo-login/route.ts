import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";
import { isDemoEnv } from "@/lib/demo";
import { creditPoints } from "@/lib/points";
import { SIGNUP_BONUS_POINTS } from "@/lib/plans";

const DEMO_EMAIL = "demo@playai.local";
const DEMO_PASSWORD = "demo1234";
const DEMO_NICK = "데모유저";

/** 로컬 데모: 테스트 계정 자동 생성·로그인 (성인인증 포함) */
export async function POST() {
  if (!isDemoEnv()) {
    return NextResponse.json({ error: "데모 로그인은 개발 환경에서만 사용할 수 있습니다." }, { status: 403 });
  }

  const db = getDb();
  let user = db.prepare("SELECT id FROM users WHERE email = ?").get(DEMO_EMAIL) as { id: number } | undefined;

  if (!user) {
    const info = db
      .prepare(
        "INSERT INTO users (email, nickname, pw_hash, pref, is_adult, nsfw_on, points, real_name) VALUES (?,?,?,?,1,1,0,?)"
      )
      .run(DEMO_EMAIL, DEMO_NICK, hashPassword(DEMO_PASSWORD), "male", DEMO_NICK);
    const userId = Number(info.lastInsertRowid);
    creditPoints(userId, SIGNUP_BONUS_POINTS, "FREE", "신규 가입 보너스");
    user = { id: userId };
  } else {
    db.prepare(
      "UPDATE users SET is_adult=1, nsfw_on=1, real_name=COALESCE(NULLIF(real_name,''), ?) WHERE id=?"
    ).run(DEMO_NICK, user.id);
  }

  const token = createSession(user.id);
  const res = NextResponse.json({ ok: true, email: DEMO_EMAIL });
  res.cookies.set("session", token, { httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 3600, path: "/" });
  return res;
}

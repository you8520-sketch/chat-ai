import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { isDemoEnv } from "@/lib/demo";

// 성인인증 (모의 PASS 인증 - 실서비스에서는 PASS/포트원 본인인증 연동 지점)
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json();

  // 데모: 원클릭 성인인증 (생년월일 검사 생략)
  if (body.demo === true) {
    if (!isDemoEnv()) {
      return NextResponse.json({ error: "데모 인증은 개발 환경에서만 사용할 수 있습니다." }, { status: 403 });
    }
    getDb().prepare("UPDATE users SET is_adult = 1 WHERE id = ?").run(user.id);
    const nick = (
      getDb().prepare("SELECT nickname FROM users WHERE id = ?").get(user.id) as { nickname: string }
    ).nickname;
    getDb()
      .prepare(
        "UPDATE users SET real_name = COALESCE(NULLIF(real_name, ''), ?) WHERE id = ? AND is_adult = 1"
      )
      .run(String(nick ?? "데모유저").trim(), user.id);
    return NextResponse.json({ ok: true, demo: true });
  }

  const { name, birth, carrier } = body;
  if (!name || !birth || !carrier || !/^\d{8}$/.test(birth)) {
    return NextResponse.json({ error: "이름, 생년월일(YYYYMMDD), 통신사를 입력하세요." }, { status: 400 });
  }
  const y = +birth.slice(0, 4), m = +birth.slice(4, 6) - 1, d = +birth.slice(6, 8);
  const birthday = new Date(y, m, d);
  const adultDate = new Date(birthday.getFullYear() + 19, birthday.getMonth(), birthday.getDate());
  if (new Date() < adultDate) {
    return NextResponse.json({ error: "만 19세 미만은 성인인증을 할 수 없습니다." }, { status: 403 });
  }
  getDb().prepare("UPDATE users SET is_adult = 1, real_name = COALESCE(NULLIF(?, ''), real_name) WHERE id = ?").run(
    String(name ?? "").trim(),
    user.id
  );
  return NextResponse.json({ ok: true });
}

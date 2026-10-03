import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { isDemoEnv } from "@/lib/demo";

const PROVIDER_PENDING_ERROR = "본인확인 제공업체가 아직 연동되지 않았습니다.";

// 성인인증 — 실서비스 본인확인 연동 전. 모의 PASS는 실제 인증 기록으로 쓰지 않는다.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json();

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

  return NextResponse.json(
    { error: PROVIDER_PENDING_ERROR, providerPending: true },
    { status: 403 }
  );
}

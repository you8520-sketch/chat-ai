import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getLatestNoticeId, markNoticesRead } from "@/lib/notices";

/** 공지 확인 — DB(로그인) + 쿠키(비로그인) 갱신 */
export async function POST() {
  const user = await getSessionUser();
  const db = getDb();
  const latestId = getLatestNoticeId(db);
  markNoticesRead(db, user?.id ?? null, latestId);

  const res = NextResponse.json({ ok: true, latestId });
  res.cookies.set("notice_read_id", String(latestId), {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return res;
}

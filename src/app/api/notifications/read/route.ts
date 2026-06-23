import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getLatestNoticeId, markNoticesRead } from "@/lib/notices";
import { markCreatorNotificationsRead } from "@/lib/userNotifications";

/** 알림 확인 — 크리에이터 알림(로그인) + 공지(DB/쿠키) 갱신 */
export async function POST() {
  const user = await getSessionUser();
  const db = getDb();
  const latestId = getLatestNoticeId(db);

  if (user) {
    markCreatorNotificationsRead(db, user.id);
  }
  markNoticesRead(db, user?.id ?? null, latestId);

  const res = NextResponse.json({ ok: true, latestId });
  res.cookies.set("notice_read_id", String(latestId), {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return res;
}

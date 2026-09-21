import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getLatestNoticeId, markNoticesRead, markSingleNoticeRead } from "@/lib/notices";
import {
  markCreatorNotificationsRead,
  markSingleUserNotificationRead,
} from "@/lib/userNotifications";

type ReadBody = {
  noticeId?: number;
  activityId?: number;
};

/** 알림 읽음 — 단건(공지/활동) 또는 전체(알림 페이지) */
export async function POST(req: Request) {
  const user = await getSessionUser();
  const db = getDb();
  const cookieStore = await cookies();
  const cookieReadId = Number(cookieStore.get("notice_read_id")?.value ?? 0);

  let body: ReadBody = {};
  try {
    body = (await req.json()) as ReadBody;
  } catch {
    body = {};
  }

  const noticeId = Number(body.noticeId);
  const activityId = Number(body.activityId);
  const hasSingleNotice = Number.isFinite(noticeId) && noticeId > 0;
  const hasSingleActivity = Number.isFinite(activityId) && activityId > 0;

  if (hasSingleNotice) {
    markSingleNoticeRead(db, user?.id ?? null, noticeId);
    const nextCookieReadId = Math.max(cookieReadId, noticeId);
    const res = NextResponse.json({ ok: true, noticeId, latestId: nextCookieReadId });
    res.cookies.set("notice_read_id", String(nextCookieReadId), {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
    return res;
  }

  if (hasSingleActivity) {
    if (!user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }
    markSingleUserNotificationRead(db, user.id, activityId);
    return NextResponse.json({ ok: true, activityId });
  }

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

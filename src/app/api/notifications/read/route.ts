import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  applyGuestNoticeReadCookies,
  readGuestNoticeReadState,
} from "@/lib/noticeGuestReadCookies";
import {
  getLatestNoticeId,
  markAllGuestNoticeReads,
  markNoticesRead,
  markSingleNoticeRead,
} from "@/lib/notices";
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
  let guestState = readGuestNoticeReadState({
    watermarkRaw: cookieStore.get("notice_read_id")?.value,
    sparseRaw: cookieStore.get("notice_read_ids")?.value,
  });

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
    guestState = markSingleNoticeRead(db, user?.id ?? null, noticeId, guestState);
    const res = NextResponse.json({ ok: true, noticeId, guestState });
    applyGuestNoticeReadCookies(res, guestState);
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
  guestState = markAllGuestNoticeReads(latestId);

  const res = NextResponse.json({ ok: true, latestId, guestState });
  applyGuestNoticeReadCookies(res, guestState);
  return res;
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { readGuestNoticeReadState } from "@/lib/noticeGuestReadCookies";
import {
  getTotalUnreadCount,
  listRecentNoticesWithReadStatus,
  listUserNotifications,
} from "@/lib/userNotifications";

export async function GET() {
  const user = await getSessionUser();
  const db = getDb();
  const cookieStore = await cookies();
  const guestState = readGuestNoticeReadState({
    watermarkRaw: cookieStore.get("notice_read_id")?.value,
    sparseRaw: cookieStore.get("notice_read_ids")?.value,
  });

  const recentNotices = listRecentNoticesWithReadStatus(db, user?.id ?? null, guestState, 50);
  const activities = user ? listUserNotifications(db, user.id, 50) : [];
  const unreadCount = getTotalUnreadCount(db, user?.id ?? null, guestState);

  return NextResponse.json({
    recentNotices,
    notices: recentNotices.filter((notice) => notice.unread),
    activities,
    creatorAlerts: activities,
    unreadCount,
  });
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  getTotalUnreadCount,
  listRecentNoticesWithReadStatus,
  listUserNotifications,
} from "@/lib/userNotifications";

export async function GET() {
  const user = await getSessionUser();
  const db = getDb();
  const cookieStore = await cookies();
  const cookieReadId = Number(cookieStore.get("notice_read_id")?.value ?? 0);
  const readId = user?.notice_last_read_id ?? cookieReadId;

  const recentNotices = listRecentNoticesWithReadStatus(db, user?.id ?? null, cookieReadId, 50);
  const activities = user ? listUserNotifications(db, user.id, 50) : [];
  const unreadCount = getTotalUnreadCount(db, user?.id ?? null, readId);

  return NextResponse.json({
    recentNotices,
    notices: recentNotices.filter((notice) => notice.unread),
    activities,
    creatorAlerts: activities,
    unreadCount,
  });
}

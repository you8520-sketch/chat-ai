import Link from "next/link";
import { cookies } from "next/headers";
import { AppPageShell } from "@/components/AppPageShell";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isNoticeRead } from "@/lib/notices";
import { cn, studioType } from "@/lib/studioDesign";
import {
  listRecentNotices,
  listRecentUserNotifications,
  notificationHref,
  notificationIcon,
  type NoticeRow,
  type UserNotificationRow,
} from "@/lib/userNotifications";
import MarkNotificationsRead from "./MarkNotificationsRead";

export const dynamic = "force-dynamic";

function formatDate(iso: string) {
  return new Date(iso + "Z").toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type FeedItem =
  | { key: string; createdAt: string; unread: boolean; kind: "notice"; notice: NoticeRow }
  | { key: string; createdAt: string; unread: boolean; kind: "activity"; activity: UserNotificationRow };

export default async function NotificationsPage() {
  const user = await getSessionUser();
  const db = getDb();
  const cookieStore = await cookies();
  const cookieReadId = Number(cookieStore.get("notice_read_id")?.value ?? 0);

  const notices = listRecentNotices(db, 20);
  const activities = user ? listRecentUserNotifications(db, user.id, 50) : [];
  const noticeIdsFromActivity = new Set(
    activities.filter((item) => item.type === "notice").map((item) => item.ref_id)
  );
  const feed: FeedItem[] = [
    ...notices
      .filter((notice) => !noticeIdsFromActivity.has(notice.id))
      .map((notice) => ({
        key: `notice-${notice.id}`,
        createdAt: notice.created_at,
        unread: !isNoticeRead(db, user?.id ?? null, notice.id, cookieReadId),
        kind: "notice" as const,
        notice,
      })),
    ...activities.map((activity) => ({
      key: `activity-${activity.id}`,
      createdAt: activity.created_at,
      unread: !activity.read_at,
      kind: "activity" as const,
      activity,
    })),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return (
    <AppPageShell
      title="알림"
      description="공지·이벤트, 포인트 지급·소멸, 제작 캐릭터 승인, 신고·문의 결과, 좋아요·댓글·팔로우를 확인하세요."
      narrow
      className="mt-4"
    >
      <MarkNotificationsRead />

      {feed.length === 0 && (
        <p className="mt-16 text-center text-zinc-400">새 알림이 없습니다.</p>
      )}

      {feed.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-violet-400">전체 알림</h2>
            <Link href="/board/notice" className={cn(studioType.caption, "transition hover:text-zinc-50")}>
              공지 게시판 →
            </Link>
          </div>
          <div className="space-y-2">
            {feed.map((item) => {
              if (item.kind === "notice") {
                const notice = item.notice;
                return (
                  <Link
                    key={item.key}
                    href="/board/notice"
                    className={`block rounded-xl border bg-[#131626] p-4 transition hover:border-violet-500/40 ${
                      item.unread ? "border-violet-500/30" : "border-white/10"
                    }`}
                  >
                    <p className="font-semibold text-zinc-50">
                      {item.unread && (
                        <span className="mr-1.5 inline-block rounded bg-violet-600/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          새
                        </span>
                      )}
                      {notice.title}
                    </p>
                    <p className={cn(studioType.body, "mt-1 line-clamp-2")}>{notice.content}</p>
                    <p className={cn(studioType.caption, "mt-2")}>
                      {notice.author_name} · {formatDate(notice.created_at)}
                    </p>
                  </Link>
                );
              }

              const activity = item.activity;
              const icon = notificationIcon(activity.type);
              const showCharacterAvatar = activity.type === "creator_character";
              return (
                <Link
                  key={item.key}
                  href={notificationHref(activity)}
                  className={`flex items-center gap-3 rounded-xl border bg-[#131626] p-4 transition hover:border-violet-500/40 ${
                    item.unread ? "border-violet-500/30" : "border-white/10"
                  }`}
                >
                  {showCharacterAvatar ? (
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl"
                      style={{ background: `hsl(${activity.hue ?? 260} 60% 20%)` }}
                    >
                      {activity.emoji ?? icon}
                    </div>
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5 text-xl">
                      {icon}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-zinc-50">
                      {item.unread && (
                        <span className="mr-1.5 inline-block rounded bg-violet-600/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          새
                        </span>
                      )}
                      {activity.title}
                    </p>
                    <p className={cn(studioType.body, "truncate")}>{activity.body}</p>
                    <p className={cn(studioType.caption, "mt-1")}>{formatDate(activity.created_at)}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {!user && (
        <p className={cn(studioType.body, "mt-10 text-center")}>
          <Link href="/login" className="text-violet-400 hover:underline">
            로그인
          </Link>
          하면 공지·이벤트·포인트·승인·문의 결과 알림을 받을 수 있습니다.
        </p>
      )}
    </AppPageShell>
  );
}

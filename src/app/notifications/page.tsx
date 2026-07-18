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

export default async function NotificationsPage() {
  const user = await getSessionUser();
  const db = getDb();
  const cookieStore = await cookies();
  const cookieReadId = Number(cookieStore.get("notice_read_id")?.value ?? 0);
  const readId = user?.notice_last_read_id ?? cookieReadId;

  const notices = listRecentNotices(db, 20);
  const activities = user ? listRecentUserNotifications(db, user.id, 50) : [];
  const hasAny = notices.length > 0 || activities.length > 0;

  return (
    <AppPageShell
      title="알림"
      description="공지사항, 좋아요·댓글·팔로우, 선물·결제, 팔로우한 크리에이터 신작을 확인하세요."
      narrow
      className="mt-4"
    >
      <MarkNotificationsRead />

      {!hasAny && (
        <p className="mt-16 text-center text-zinc-400">새 알림이 없습니다.</p>
      )}

      {notices.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-violet-400">공지사항</h2>
            <Link href="/board/notice" className={cn(studioType.caption, "transition hover:text-zinc-50")}>
              전체 보기 →
            </Link>
          </div>
          <div className="space-y-2">
            {notices.map((n) => {
              const unread = !isNoticeRead(db, user?.id ?? null, n.id, cookieReadId);
              return (
              <Link
                key={n.id}
                href="/board/notice"
                className={`block rounded-xl border bg-[#131626] p-4 transition hover:border-violet-500/40 ${
                  unread ? "border-violet-500/30" : "border-white/10"
                }`}
              >
                <p className="font-semibold text-zinc-50">
                  {unread && (
                    <span className="mr-1.5 inline-block rounded bg-violet-600/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      새
                    </span>
                  )}
                  {n.title}
                </p>
                <p className={cn(studioType.body, "mt-1 line-clamp-2")}>{n.content}</p>
                <p className={cn(studioType.caption, "mt-2")}>
                  {n.author_name} · {formatDate(n.created_at)}
                </p>
              </Link>
            );
            })}
          </div>
        </section>
      )}

      {activities.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-violet-400">활동</h2>
          <div className="space-y-2">
            {activities.map((n) => {
              const icon = notificationIcon(n.type);
              const showCharacterAvatar = n.type === "creator_character";
              const unread = !n.read_at;
              return (
                <Link
                  key={n.id}
                  href={notificationHref(n)}
                  className={`flex items-center gap-3 rounded-xl border bg-[#131626] p-4 transition hover:border-violet-500/40 ${
                    unread ? "border-violet-500/30" : "border-white/10"
                  }`}
                >
                  {showCharacterAvatar ? (
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl"
                      style={{ background: `hsl(${n.hue ?? 260} 60% 20%)` }}
                    >
                      {n.emoji ?? icon}
                    </div>
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5 text-xl">
                      {icon}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-zinc-50">
                      {unread && (
                        <span className="mr-1.5 inline-block rounded bg-violet-600/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          새
                        </span>
                      )}
                      {n.title}
                    </p>
                    <p className={cn(studioType.body, "truncate")}>{n.body}</p>
                    <p className={cn(studioType.caption, "mt-1")}>{formatDate(n.created_at)}</p>
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
          하면 선물·결제·팔로우·신작 알림을 받을 수 있습니다.
        </p>
      )}
    </AppPageShell>
  );
}

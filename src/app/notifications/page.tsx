import Link from "next/link";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
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
    <div className="mx-auto mt-4 max-w-2xl">
      <MarkNotificationsRead />
      <h1 className="text-xl font-black text-white">알림</h1>
      <p className="mt-1 text-sm text-gray-500">
        공지사항, 선물·결제·팔로우, 팔로우한 크리에이터 신작을 확인하세요.
      </p>

      {!hasAny && (
        <p className="mt-16 text-center text-gray-500">새 알림이 없습니다.</p>
      )}

      {notices.length > 0 && (
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-violet-400">공지사항</h2>
            <Link href="/board/notice" className="text-xs text-gray-500 hover:text-white">
              전체 보기 →
            </Link>
          </div>
          <div className="space-y-2">
            {notices.map((n) => {
              const unread = n.id > readId;
              return (
              <Link
                key={n.id}
                href="/board/notice"
                className={`block rounded-xl border bg-[#131626] p-4 transition hover:border-violet-500/40 ${
                  unread ? "border-violet-500/30" : "border-white/5"
                }`}
              >
                <p className="font-semibold text-white">
                  {unread && (
                    <span className="mr-1.5 inline-block rounded bg-violet-600/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      새
                    </span>
                  )}
                  {n.title}
                </p>
                <p className="mt-1 line-clamp-2 text-sm text-gray-400">{n.content}</p>
                <p className="mt-2 text-xs text-gray-500">
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
          <h2 className="mb-3 text-sm font-bold text-violet-400">활동</h2>
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
                    unread ? "border-violet-500/30" : "border-white/5"
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
                    <p className="font-semibold text-white">
                      {unread && (
                        <span className="mr-1.5 inline-block rounded bg-violet-600/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          새
                        </span>
                      )}
                      {n.title}
                    </p>
                    <p className="truncate text-sm text-gray-400">{n.body}</p>
                    <p className="mt-1 text-xs text-gray-500">{formatDate(n.created_at)}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {!user && (
        <p className="mt-10 text-center text-sm text-gray-500">
          <Link href="/login" className="text-violet-400 hover:underline">
            로그인
          </Link>
          하면 선물·결제·팔로우·신작 알림을 받을 수 있습니다.
        </p>
      )}
    </div>
  );
}

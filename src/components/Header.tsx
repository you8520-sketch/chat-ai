import Link from "next/link";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getLatestNoticeId, hasUnreadNotices } from "@/lib/notices";
import { getTotalUnreadCount } from "@/lib/userNotifications";
import AnimatedPointsBadge from "./AnimatedPointsBadge";
import LogoutButton from "./LogoutButton";
import MobileBottomNav from "./MobileBottomNav";
import NotificationBell from "./NotificationBell";
import PointsShopLink from "./PointsShopLink";
import HeaderMainNavRow from "./HeaderMainNavRow";
import UserPreferenceControls from "./UserPreferenceControls";
import { getPointBalance } from "@/lib/points";
const topLinks = [
  { href: "/board/notice", label: "공지사항", noticeBadge: true },
  { href: "/board/inquiry", label: "문의 게시판" },
  { href: "/board/faq", label: "FAQ" },
];

export default async function Header() {
  const user = await getSessionUser();
  const db = getDb();
  const latestNoticeId = getLatestNoticeId(db);
  const cookieStore = await cookies();
  const cookieReadId = Number(cookieStore.get("notice_read_id")?.value ?? 0);
  const readId = user?.notice_last_read_id ?? cookieReadId;
  const unreadNotice = hasUnreadNotices(latestNoticeId, readId);
  const unreadCount = getTotalUnreadCount(db, user?.id ?? null, readId);
  const pointBalance = user ? getPointBalance(user.id) : null;

  return (
    <>
    <header className="sticky top-0 z-40 border-b border-white/5 bg-[#0b0d14]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2 text-xs">
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href="/" className="shrink-0 text-xl font-black tracking-tight text-white">
            하비 <span className="text-violet-400">AI</span>
          </Link>
          {topLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="font-medium text-zinc-300 transition hover:text-white"
            >
              {l.label}
              {l.noticeBadge && unreadNotice && (
                <sup className="ml-0.5 text-[9px] font-bold text-red-400">N</sup>
              )}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2 whitespace-nowrap sm:gap-3">
          <NotificationBell count={unreadCount} />
          {user ? (
            <>
              <UserPreferenceControls
                isAdult={!!user.is_adult}
                nsfwOn={!!user.nsfw_on}
                pref={(user.pref as "female" | "male" | null) ?? null}
                variant="header"
              />
              <div className="flex items-center gap-0.5">
                <AnimatedPointsBadge
                  initialPoints={pointBalance?.total ?? user.points}
                  initialPaid={pointBalance?.paid ?? 0}
                  initialFree={pointBalance?.free ?? 0}
                />
                <PointsShopLink />
              </div>
              {!user.is_adult && (
                <Link href="/verify" className="text-amber-300 hover:underline">
                  성인인증
                </Link>
              )}
              <Link
                href="/settings"
                className="font-semibold text-gray-300 transition hover:text-white"
                title="내 정보 · 설정"
              >
                {user.nickname}
              </Link>
              <LogoutButton />
            </>
          ) : (
            <Link href="/login" className="rounded-full bg-violet-600 px-4 py-1.5 font-semibold text-white hover:bg-violet-500">
              로그인 하고 채팅하기
            </Link>
          )}
        </div>
      </div>
      <HeaderMainNavRow />
    </header>
    <MobileBottomNav loggedIn={!!user} unreadCount={unreadCount} />
    </>
  );
}

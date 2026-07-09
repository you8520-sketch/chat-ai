import Link from "next/link";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getLatestNoticeId, getUnreadNoticeCount, hasUnreadNotices } from "@/lib/notices";
import { getTotalUnreadCount } from "@/lib/userNotifications";
import AnimatedPointsBadge from "./AnimatedPointsBadge";
import LogoutButton from "./LogoutButton";
import MobileBottomNav from "./MobileBottomNav";
import NotificationBell from "./NotificationBell";
import PointsShopLink from "./PointsShopLink";
import HeaderMainNavRow from "./HeaderMainNavRow";
import UserPreferenceControls from "./UserPreferenceControls";
import ExpiringPointsPopup from "./ExpiringPointsPopup";
import { getPointBalance } from "@/lib/points";
import { isPaymentsEnabled } from "@/lib/portoneConfig";
const topLinks = [
  { href: "/board/notice", label: "공지사항", noticeBadge: true },
  { href: "/board/inquiry", label: "문의게시판" },
  { href: "/board/faq", label: "FAQ" },
];

export default async function Header() {
  const user = await getSessionUser();
  const db = getDb();
  const latestNoticeId = getLatestNoticeId(db);
  const cookieStore = await cookies();
  const cookieReadId = Number(cookieStore.get("notice_read_id")?.value ?? 0);
  const readId = user?.notice_last_read_id ?? cookieReadId;
  const unreadNoticeCount = getUnreadNoticeCount(db, user?.id ?? null, cookieReadId);
  const unreadNotice = hasUnreadNotices(latestNoticeId, readId, unreadNoticeCount);
  const unreadCount = getTotalUnreadCount(db, user?.id ?? null, readId);
  const pointBalance = user ? getPointBalance(user.id) : null;
  const paymentsEnabled = isPaymentsEnabled();

  return (
    <>
    <header className="sticky top-0 z-40 border-b border-white/5 bg-[#0b0d14]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-nowrap items-center justify-between gap-2 px-4 py-2 text-xs sm:gap-4">
        <nav className="flex min-w-0 flex-1 flex-nowrap items-center gap-3 overflow-x-auto whitespace-nowrap pr-1 scrollbar-thin sm:gap-4">
          <Link href="/" className="shrink-0 text-xl font-black tracking-tight text-white">
            하비 <span className="text-violet-400">AI</span>
          </Link>
          {topLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="shrink-0 font-medium text-zinc-300 transition hover:text-white"
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
                {paymentsEnabled && <PointsShopLink />}
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
    <MobileBottomNav loggedIn={!!user} />
    {user && <ExpiringPointsPopup />}
    </>
  );
}

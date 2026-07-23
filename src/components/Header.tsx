import Link from "next/link";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getLatestNoticeId, getUnreadNoticeCount, hasUnreadNotices } from "@/lib/notices";
import { getTotalUnreadCount } from "@/lib/userNotifications";
import AnimatedPointsBadge from "./AnimatedPointsBadge";
import MobileBottomNav from "./MobileBottomNav";
import NotificationBell from "./NotificationBell";
import PointsShopLink from "./PointsShopLink";
import HeaderMainNavRow from "./HeaderMainNavRow";
import HeaderBoardLinks from "./HeaderBoardLinks";
import HeaderProfileMenu from "./HeaderProfileMenu";
import UserPreferenceControls from "./UserPreferenceControls";
import ExpiringPointsPopup from "./ExpiringPointsPopup";
import { getPointBalance } from "@/lib/points";
import { isPaymentsEnabled } from "@/lib/portoneConfig";

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
      <header className="site-header sticky top-0 z-40 border-b border-white/[0.08] bg-[#070910]/88 shadow-[0_12px_40px_rgba(0,0,0,.18)] backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 max-w-7xl flex-nowrap items-center justify-between gap-2 px-3 text-xs sm:gap-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Link
              href="/"
              className="group flex shrink-0 items-center gap-2.5 text-lg font-semibold tracking-tight text-zinc-50 sm:text-xl"
            >
              <span className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-[0.7rem] border border-violet-300/25 bg-gradient-to-br from-violet-500 to-indigo-700 text-xs font-black text-white shadow-[0_0_24px_rgba(124,58,237,.26)] transition group-hover:rotate-[-3deg] group-hover:scale-105">
                H
                <span className="absolute inset-[4px] rounded-[0.45rem] border border-white/20" />
              </span>
              <span className="hidden tracking-[-0.035em] sm:inline">
                하비 <span className="text-violet-400">AI</span>
              </span>
            </Link>
            <HeaderMainNavRow />
            <HeaderBoardLinks unreadNotice={unreadNotice} />
          </div>

          <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap sm:gap-2">
            {user ? (
              <>
                <NotificationBell count={unreadCount} />
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
                  <Link
                    href="/verify"
                    className="hidden text-xs font-medium text-zinc-400 transition hover:text-violet-300 sm:inline"
                  >
                    성인인증
                  </Link>
                )}
                <HeaderProfileMenu nickname={user.nickname} />
              </>
            ) : (
              <>
                <NotificationBell count={unreadCount} />
                <Link
                  href="/login"
                  className="inline-flex min-h-9 items-center rounded-xl bg-violet-600 px-3.5 text-sm font-semibold text-white transition hover:bg-violet-500 sm:px-4"
                >
                  로그인
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <MobileBottomNav loggedIn={!!user} unreadCount={unreadCount} />
      {user && <ExpiringPointsPopup />}
    </>
  );
}

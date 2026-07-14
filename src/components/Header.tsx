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
      <header className="site-header sticky top-0 z-40 border-b border-white/10 bg-[#0b0d14]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-nowrap items-center justify-between gap-2 px-3 py-2.5 text-xs sm:gap-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Link
              href="/"
              className="shrink-0 text-lg font-semibold tracking-tight text-zinc-50 sm:text-xl"
            >
              하비 <span className="text-violet-400">AI</span>
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
      <MobileBottomNav loggedIn={!!user} />
      {user && <ExpiringPointsPopup />}
    </>
  );
}

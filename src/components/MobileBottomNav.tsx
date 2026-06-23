import Link from "next/link";

type Props = {
  loggedIn: boolean;
  unreadCount?: number;
};

/** md 미만: 하단 고정 네비 (왼쪽 사이드바 대체) */
export default function MobileBottomNav({ loggedIn, unreadCount = 0 }: Props) {
  if (!loggedIn) return null;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-[#0b0d14]/95 backdrop-blur md:hidden"
      aria-label="모바일 메뉴"
    >
      <div className="mx-auto flex max-w-lg">
        <MobileNavItem href="/" label="홈" />
        <MobileNavItem href="/chats" label="대화" accent />
        <MobileNavItem href="/notifications" label="알림" badge={unreadCount} />
        <MobileNavItem href="/search" label="검색" />
        <MobileNavItem href="/settings" label="설정" />
      </div>
    </nav>
  );
}

function MobileNavItem({
  href,
  label,
  accent,
  badge,
}: {
  href: string;
  label: string;
  accent?: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={`relative flex flex-1 flex-col items-center justify-center py-3 text-xs font-semibold ${
        accent ? "text-violet-400" : "text-zinc-400"
      }`}
    >
      {label}
      {badge != null && badge > 0 && (
        <span className="absolute right-[calc(50%-1.25rem)] top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-violet-600 px-0.5 text-[8px] font-bold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

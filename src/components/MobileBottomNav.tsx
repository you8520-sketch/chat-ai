"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isCompactRoomPathname } from "@/lib/chatDisplayPrefs";
import { cn } from "@/lib/studioDesign";

type Props = {
  loggedIn: boolean;
};

const DISCOVERY_ITEMS = [
  { href: "/", label: "홈" },
  { href: "/tab/new", label: "신작" },
  { href: "/tab/ranking", label: "랭킹" },
  { href: "/trpg", label: "TRPG" },
  { href: "/search", label: "검색" },
] as const;

const ACCOUNT_ITEMS = [
  { href: "/chats", label: "대화" },
  { href: "/studio", label: "제작" },
  { href: "/settings", label: "설정" },
] as const;

const GUEST_ACCOUNT_ITEMS = [{ href: "/login", label: "로그인" }] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isAuthFormPathname(pathname: string): boolean {
  return pathname === "/login" || pathname === "/signup";
}

function NavItem({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center rounded-xl px-0.5 text-xs font-semibold transition",
        active
          ? "bg-violet-500/15 text-violet-50"
          : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200",
      )}
    >
      {label}
    </Link>
  );
}

/**
 * 576px 미만: 하단 고정 네비. 콘텐츠 탐색(홈·신작·랭킹·TRPG·검색)과 내 계정(대화·제작·설정, 비로그인은 로그인)을
 * 한 줄에서 구분선·배경으로 나눈다. 드롭다운/시트 없음. DOM 은 본문·푸터 뒤(layout)에 둬 Tab 순서가 화면 순서를 따른다.
 */
export default function MobileBottomNav({ loggedIn }: Props) {
  const pathname = usePathname();
  if (isCompactRoomPathname(pathname) || isAuthFormPathname(pathname)) return null;

  const accountItems = loggedIn ? ACCOUNT_ITEMS : GUEST_ACCOUNT_ITEMS;

  return (
    <nav
      className="mobile-bottom-nav fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-[#0b0d14]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur min-[576px]:hidden"
      aria-label="모바일 메뉴"
      data-menu-transition=""
    >
      <div className="mx-auto flex max-w-lg items-stretch gap-1 px-2 py-1">
        <div role="group" aria-label="콘텐츠 탐색" className="flex flex-[5] gap-0.5">
          {DISCOVERY_ITEMS.map((item) => (
            <NavItem key={item.href} {...item} active={isActive(pathname, item.href)} />
          ))}
        </div>
        <span aria-hidden className="my-1.5 w-px shrink-0 bg-white/15" />
        <div
          role="group"
          aria-label="내 계정"
          className={cn(
            "flex gap-0.5 rounded-xl bg-white/[0.045] px-0.5",
            loggedIn ? "flex-[3]" : "flex-[1.4]",
          )}
        >
          {accountItems.map((item) => (
            <NavItem key={item.href} {...item} active={loggedIn && isActive(pathname, item.href)} />
          ))}
        </div>
      </div>
    </nav>
  );
}

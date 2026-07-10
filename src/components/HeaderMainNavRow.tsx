"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isChatRoomPathname } from "@/lib/chatDisplayPrefs";
import { cn, studioSurface } from "@/lib/studioDesign";

const baseTabs = [
  { href: "/", label: "홈" },
  { href: "/tab/new", label: "신작" },
  { href: "/tab/ranking", label: "랭킹" },
  { href: "/search", label: "검색" },
  { href: "/tab/following", label: "팔로잉" },
];

function isTabActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** 데스크톱 상단 탭 — 모바일은 하단 탭 사용. 채팅방에서는 숨김 */
export default function HeaderMainNavRow() {
  const pathname = usePathname();
  if (isChatRoomPathname(pathname)) return null;

  return (
    <div className="mx-auto hidden max-w-6xl px-4 pb-2.5 pt-0.5 md:block">
      <nav
        className={cn(studioSurface.tabList, "w-fit max-w-full overflow-x-auto")}
        aria-label="주요 메뉴"
      >
        {baseTabs.map((t) => {
          const active = isTabActive(pathname, t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "min-h-10 shrink-0 rounded-lg px-3.5 text-sm font-semibold transition",
                "inline-flex items-center",
                active ? studioSurface.tabActive : studioSurface.tabIdle,
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

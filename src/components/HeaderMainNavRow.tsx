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
  { href: "/tab/following", label: "북마크/팔로잉" },
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
    <nav
      className={cn(
        studioSurface.tabList,
        "hidden max-w-[48vw] shrink overflow-x-auto rounded-2xl border-white/10 bg-white/[0.045] p-1 shadow-lg shadow-black/10 md:inline-flex xl:max-w-none"
      )}
      aria-label="주요 메뉴"
    >
      {baseTabs.map((t) => {
        const active = isTabActive(pathname, t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "inline-flex min-h-9 shrink-0 items-center rounded-xl px-3 text-sm font-semibold transition",
              active ? studioSurface.tabActive : studioSurface.tabIdle,
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

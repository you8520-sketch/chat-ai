"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isChatRoomPathname } from "@/lib/chatDisplayPrefs";

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
    <div className="mx-auto hidden max-w-6xl px-4 pb-2 pt-0.5 md:block">
      <nav className="flex min-w-0 gap-1 overflow-x-auto text-sm scrollbar-thin" aria-label="주요 메뉴">
        {baseTabs.map((t) => {
          const active = isTabActive(pathname, t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`shrink-0 rounded-xl px-3 py-2 font-semibold transition ${
                active
                  ? "bg-violet-600/20 text-violet-200"
                  : "text-zinc-400 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

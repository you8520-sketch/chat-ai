"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isChatRoomPathname } from "@/lib/chatDisplayPrefs";
import { cn } from "@/lib/studioDesign";

const baseTabs = [
  { href: "/", label: "홈" },
  { href: "/tab/new", label: "신작" },
  { href: "/tab/ranking", label: "랭킹" },
  { href: "/trpg", label: "TRPG" },
  { href: "/search", label: "검색" },
  { href: "/tab/following", label: "북마크/팔로잉" },
];

function isTabActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

type Props = {
  /** inline: lg 이상 로고 옆 · strip: 576–1023px 헤더 둘째 줄 (모바일은 하단 탭 사용) */
  variant?: "inline" | "strip";
};

/** 상단 주요 탭 — 채팅방에서는 숨김 */
export default function HeaderMainNavRow({ variant = "inline" }: Props) {
  const pathname = usePathname();
  if (isChatRoomPathname(pathname)) return null;

  return (
    <nav
      className={cn(
        "scrollbar-hide items-stretch gap-0.5 overflow-x-auto overscroll-x-contain",
        variant === "inline"
          ? "hidden shrink lg:inline-flex"
          : "hidden min-[576px]:flex lg:hidden",
      )}
      aria-label="주요 메뉴"
      data-menu-transition=""
    >
      {baseTabs.map((t) => {
        const active = isTabActive(pathname, t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative inline-flex min-h-11 shrink-0 items-center px-3 text-sm font-semibold transition after:absolute after:inset-x-3 after:bottom-0 after:h-px after:origin-left after:bg-violet-400 after:transition-transform",
              active
                ? "text-zinc-50 after:scale-x-100"
                : "text-zinc-400 after:scale-x-0 hover:text-zinc-100 hover:after:scale-x-100",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

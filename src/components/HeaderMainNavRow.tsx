"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import HeaderTagSearchBar from "./HeaderTagSearchBar";
import { isChatRoomPathname } from "@/lib/chatDisplayPrefs";

const baseTabs = [
  { href: "/", label: "홈" },
  { href: "/tab/new", label: "신작" },
  { href: "/tab/ranking", label: "랭킹" },
  { href: "/tab/genre", label: "장르" },
  { href: "/search", label: "검색" },
  { href: "/tab/following", label: "팔로잉" },
];

/** 홈·신작·랭킹 등 — 채팅방(`/chat/[id]`)에서는 숨김 */
export default function HeaderMainNavRow() {
  const pathname = usePathname();
  if (isChatRoomPathname(pathname)) return null;

  return (
    <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 pb-2 pt-1">
      <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto text-sm scrollbar-thin">
        {baseTabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`shrink-0 rounded-t-lg px-3 py-2 font-semibold text-gray-400 hover:bg-white/5 hover:text-white ${
              t.href === "/search" ? "hidden md:inline-block" : ""
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <HeaderTagSearchBar className="hidden w-full min-w-0 sm:flex sm:max-w-[13.25rem] md:max-w-64 lg:max-w-[18.75rem]" />
    </div>
  );
}

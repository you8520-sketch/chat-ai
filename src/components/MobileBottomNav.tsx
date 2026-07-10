"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isChatRoomPathname } from "@/lib/chatDisplayPrefs";

type Props = {
  loggedIn: boolean;
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** md 미만: 하단 고정 네비. 채팅방에서는 숨김. 드롭다운/시트 없음. */
export default function MobileBottomNav({ loggedIn }: Props) {
  const pathname = usePathname();
  if (!loggedIn) return null;
  if (isChatRoomPathname(pathname)) return null;

  const items = [
    { href: "/", label: "홈" },
    { href: "/chats", label: "대화" },
    { href: "/studio", label: "제작" },
    { href: "/settings", label: "설정" },
  ] as const;

  return (
    <nav
      className="mobile-bottom-nav fixed bottom-0 left-0 right-0 z-30 border-t border-white/[0.08] bg-[#0b0d14]/95 backdrop-blur md:hidden"
      aria-label="모바일 메뉴"
    >
      <div className="mx-auto flex max-w-lg">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex flex-1 flex-col items-center justify-center py-3 text-xs font-semibold transition ${
                active ? "text-violet-300" : "text-zinc-500"
              }`}
            >
              {item.label}
              {active && (
                <span className="absolute inset-x-6 bottom-1 h-0.5 rounded-full bg-violet-500" aria-hidden />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

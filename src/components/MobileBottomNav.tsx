"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isCompactRoomPathname } from "@/lib/chatDisplayPrefs";
import { cn } from "@/lib/studioDesign";

type Props = {
  loggedIn: boolean;
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** 576px 미만: 하단 고정 네비. 드롭다운/시트 없음. DOM 은 본문·푸터 뒤(layout)에 둬 Tab 순서가 화면 순서를 따른다. */
export default function MobileBottomNav({ loggedIn }: Props) {
  const pathname = usePathname();
  if (!loggedIn || isCompactRoomPathname(pathname)) return null;

  const items = [
    { href: "/", label: "홈" },
    { href: "/chats", label: "대화" },
    { href: "/studio", label: "제작" },
    { href: "/settings", label: "설정" },
  ] as const;

  return (
    <nav
      className="mobile-bottom-nav fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-[#0b0d14]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur min-[576px]:hidden"
      aria-label="모바일 메뉴"
      data-menu-transition=""
    >
      <div className="mx-auto flex max-w-lg gap-1 px-2 py-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-11 flex-1 flex-col items-center justify-center rounded-xl text-xs font-semibold transition",
                active
                  ? "bg-violet-500/15 text-violet-50"
                  : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

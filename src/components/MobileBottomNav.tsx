"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/studioDesign";
import {
  IconNavHome,
  IconNavSettings,
  IconSidebarChat,
  IconSidebarStudio,
} from "./SidebarNavIcons";

type Props = {
  loggedIn: boolean;
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** md 미만: 하단 고정 네비. 드롭다운/시트 없음. */
export default function MobileBottomNav({ loggedIn }: Props) {
  const pathname = usePathname();
  if (!loggedIn) return null;

  const items = [
    { href: "/", label: "홈", Icon: IconNavHome },
    { href: "/chats", label: "대화", Icon: IconSidebarChat },
    { href: "/studio", label: "제작", Icon: IconSidebarStudio },
    { href: "/settings", label: "설정", Icon: IconNavSettings },
  ] as const;

  return (
    <nav
      className="mobile-bottom-nav fixed bottom-0 left-0 right-0 z-30 border-t border-violet-300/15 bg-[#0b0d14]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur min-[576px]:hidden"
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
                "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold transition",
                active
                  ? "bg-gradient-to-b from-violet-500/25 to-violet-500/5 text-white"
                  : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200",
              )}
            >
              <item.Icon
                className={cn(
                  "h-5 w-5 shrink-0",
                  active && "text-violet-200 drop-shadow-[0_0_6px_rgba(167,139,250,.65)]",
                )}
              />
              {item.label}
              {active ? (
                <span
                  className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-violet-300 shadow-[0_0_10px_rgba(167,139,250,.8)]"
                  aria-hidden
                />
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

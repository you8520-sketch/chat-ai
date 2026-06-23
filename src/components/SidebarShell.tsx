"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type MouseEvent, Suspense } from "react";
import type { UserChatSession } from "@/lib/recentChats";
import SidebarRecentChatIcons from "./SidebarRecentChatIcons";
import { CHAT_GLOBAL_HEADER_OFFSET_CLASS, isChatRoomPathname } from "@/lib/chatDisplayPrefs";
import {
  IconSidebarChevronLeft,
  IconSidebarChevronRight,
  IconSidebarUser,
  SidebarNavIcon,
  type SidebarNavIconId,
} from "./SidebarNavIcons";

export type SidebarNavItem = {
  href: string;
  icon: SidebarNavIconId;
  label: string;
};

type Props = {
  user: { nickname: string } | null;
  chatSessions: UserChatSession[];
  blurNsfw: boolean;
  navItems: SidebarNavItem[];
};

function isNavActive(pathname: string, href: string): boolean {
  const path = href.split("?")[0]!;
  if (path === "/") return pathname === "/" || pathname.startsWith("/tab/");
  if (path === "/login") return false;
  return pathname === path || pathname.startsWith(`${path}/`);
}

export default function SidebarShell({ user, chatSessions, blurNsfw, navItems }: Props) {
  const pathname = usePathname();
  const isChatRoomRoute = isChatRoomPathname(pathname);
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);

  useEffect(() => {
    setManualExpanded(null);
  }, [pathname]);

  const expanded = manualExpanded ?? !isChatRoomRoute;
  const collapsed = isChatRoomRoute && !expanded;

  function toggleExpanded() {
    setManualExpanded((prev) => {
      const current = prev ?? !isChatRoomRoute;
      return !current;
    });
  }

  function expandFromCollapsed(e: MouseEvent<HTMLElement>) {
    if (!collapsed) return;
    if ((e.target as HTMLElement).closest("a, button")) return;
    setManualExpanded(true);
  }

  return (
    <aside
      onClick={expandFromCollapsed}
      className={`sticky ${
        isChatRoomRoute ? "top-11 h-[calc(100vh-3.75rem)]" : `${CHAT_GLOBAL_HEADER_OFFSET_CLASS} h-[calc(100vh-108px)]`
      } hidden shrink-0 flex-col gap-3 overflow-hidden transition-[width] duration-200 ease-out md:flex ${
        collapsed ? "w-11" : "w-44"
      }`}
    >
      {isChatRoomRoute && (
        <button
          type="button"
          onClick={toggleExpanded}
          title={expanded ? "메뉴 접기" : "메뉴 펼치기"}
          aria-expanded={expanded}
          className="flex h-9 w-full shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-300"
        >
          {expanded ? <IconSidebarChevronLeft /> : <IconSidebarChevronRight />}
        </button>
      )}

      {!user && (
        <Link
          href="/login"
          title="로그인 / 회원가입"
          className={`flex items-center rounded-lg text-zinc-100 transition hover:bg-white/[0.06] hover:text-white ${
            collapsed ? "h-10 justify-center" : "gap-2.5 px-2.5 py-2"
          }`}
        >
          <IconSidebarUser />
          {!collapsed && <span className="text-sm font-medium">로그인 / 회원가입</span>}
        </Link>
      )}

      <nav
        className={`flex shrink-0 flex-col ${
          collapsed ? "gap-0.5" : "gap-0.5"
        }`}
      >
        {navItems.map((item) => (
          <SideLink
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={item.label}
            collapsed={collapsed}
            active={isNavActive(pathname, item.href)}
          />
        ))}
      </nav>

      {user && (
        <Suspense fallback={null}>
          <SidebarRecentChatIcons
            sessions={chatSessions}
            blurNsfw={blurNsfw}
            compact={collapsed}
            showHeader={!collapsed}
          />
        </Suspense>
      )}
    </aside>
  );
}

function SideLink({
  href,
  icon,
  label,
  collapsed,
  active,
}: {
  href: string;
  icon: SidebarNavIconId;
  label: string;
  collapsed: boolean;
  active: boolean;
}) {
  const tone = active
    ? "text-white font-semibold"
    : "text-zinc-100 hover:text-white";

  if (collapsed) {
    return (
      <Link
        href={href}
        title={label}
        className={`flex h-10 w-full items-center justify-center rounded-lg transition hover:bg-white/[0.06] ${tone}`}
      >
        <SidebarNavIcon id={icon} />
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition hover:bg-white/[0.06] ${tone}`}
    >
      <SidebarNavIcon id={icon} />
      <span>{label}</span>
    </Link>
  );
}

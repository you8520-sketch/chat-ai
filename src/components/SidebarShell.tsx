"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  Suspense,
} from "react";
import type { UserChatSession } from "@/lib/recentChats";
import SidebarRecentChatIcons from "./SidebarRecentChatIcons";
import { isChatRoomPathname } from "@/lib/chatDisplayPrefs";
import {
  IconSidebarChevronLeft,
  IconSidebarChevronRight,
  IconSidebarUser,
  SidebarNavIcon,
  type SidebarNavIconId,
} from "./SidebarNavIcons";
import { cn } from "@/lib/studioDesign";

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

/**
 * Keep left rail pinned under the sticky site header while main content scrolls.
 * Uses position:fixed + a layout spacer (sticky alone was sliding under the tab bar).
 */
function usePinnedSidebarGeometry(isChatRoom: boolean) {
  const spacerRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({
    top: isChatRoom ? 44 : 120,
    left: 0,
    width: 176,
  });

  useLayoutEffect(() => {
    const header = document.querySelector(".site-header");
    const spacer = spacerRef.current;

    const apply = () => {
      const headerH =
        header instanceof HTMLElement
          ? Math.ceil(header.getBoundingClientRect().height)
          : isChatRoom
            ? 44
            : 120;
      const rect = spacer?.getBoundingClientRect();
      setGeometry({
        top: Math.max(headerH, 0),
        left: rect ? Math.round(rect.left) : 0,
        width: rect && rect.width > 0 ? Math.round(rect.width) : 176,
      });
      document.documentElement.style.setProperty(
        "--site-header-height",
        `${Math.max(headerH, 0)}px`,
      );
    };

    apply();

    const ro = new ResizeObserver(apply);
    if (header instanceof HTMLElement) ro.observe(header);
    if (spacer) ro.observe(spacer);

    window.addEventListener("resize", apply);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [isChatRoom]);

  return { spacerRef, geometry };
}

export default function SidebarShell({ user, chatSessions, blurNsfw, navItems }: Props) {
  const pathname = usePathname();
  const isChatRoomRoute = isChatRoomPathname(pathname);
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const { spacerRef, geometry } = usePinnedSidebarGeometry(isChatRoomRoute);

  useEffect(() => {
    setManualExpanded(null);
  }, [pathname]);

  const expanded = manualExpanded ?? !isChatRoomRoute;
  const collapsed = isChatRoomRoute && !expanded;
  const railWidth = collapsed ? 44 : 176;

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
    <>
      {/* Keeps main column from sliding under the fixed rail */}
      <div
        ref={spacerRef}
        className="hidden shrink-0 md:block"
        style={{ width: railWidth }}
        aria-hidden
      />

      <aside
        onClick={expandFromCollapsed}
        style={{
          top: geometry.top,
          left: geometry.left,
          width: railWidth,
          height: `calc(100dvh - ${geometry.top}px)`,
          maxHeight: `calc(100dvh - ${geometry.top}px)`,
        }}
        className={cn(
          "fixed z-30 hidden flex-col gap-2 overflow-y-auto overflow-x-hidden overscroll-contain bg-[#0b0d14] pb-4 transition-[width] duration-200 ease-out md:flex",
        )}
      >
        {isChatRoomRoute && (
          <button
            type="button"
            onClick={toggleExpanded}
            title={expanded ? "메뉴 접기" : "메뉴 펼치기"}
            aria-expanded={expanded}
            className="flex h-10 w-full shrink-0 items-center justify-center rounded-xl text-zinc-500 transition hover:bg-white/[0.04] hover:text-zinc-300"
          >
            {expanded ? <IconSidebarChevronLeft /> : <IconSidebarChevronRight />}
          </button>
        )}

        {!user && (
          <Link
            href="/login"
            title="로그인 / 회원가입"
            className={cn(
              "flex items-center rounded-xl text-zinc-200 transition hover:bg-white/[0.04] hover:text-white",
              collapsed ? "h-11 justify-center" : "min-h-11 gap-2.5 px-2.5",
            )}
          >
            <IconSidebarUser />
            {!collapsed && <span className="text-sm font-medium">로그인 / 회원가입</span>}
          </Link>
        )}

        <nav className="flex shrink-0 flex-col gap-0.5">
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
    </>
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
    ? "bg-violet-600/15 text-violet-100 font-semibold"
    : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100";

  if (collapsed) {
    return (
      <Link
        href={href}
        title={label}
        className={`flex h-11 w-full items-center justify-center rounded-xl transition ${tone}`}
      >
        <SidebarNavIcon id={icon} />
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={`flex min-h-11 items-center gap-2.5 rounded-xl px-2.5 text-sm font-medium transition ${tone}`}
    >
      <SidebarNavIcon id={icon} />
      <span>{label}</span>
    </Link>
  );
}

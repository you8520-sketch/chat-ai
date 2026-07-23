"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Props = {
  count?: number;
  className?: string;
};

const REFRESH_INTERVAL_MS = 30_000;

export default function NotificationBell({ count = 0, className = "" }: Props) {
  const [visibleCount, setVisibleCount] = useState(count);

  useEffect(() => {
    setVisibleCount(count);
  }, [count]);

  useEffect(() => {
    let active = true;

    async function refreshCount() {
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { unreadCount?: number };
        if (active && Number.isFinite(data.unreadCount)) {
          setVisibleCount(Math.max(0, Number(data.unreadCount)));
        }
      } catch {
        // Keep the last known count when a background refresh fails.
      }
    }

    void refreshCount();
    const timer = window.setInterval(refreshCount, REFRESH_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshCount();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return (
    <Link
      href="/notifications"
      className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:border-violet-400/30 hover:bg-white/[0.08] hover:text-white ${className}`}
      title="알림"
      aria-label={visibleCount > 0 ? `알림 ${visibleCount}건` : "알림"}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[18px] w-[18px]"
        aria-hidden
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {visibleCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-[#0b0d14] bg-violet-500 px-1 text-[9px] font-bold text-white shadow-sm">
          {visibleCount > 99 ? "99+" : visibleCount}
        </span>
      )}
    </Link>
  );
}

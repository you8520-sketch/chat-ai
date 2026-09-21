"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchNotificationFeed,
  NOTIFICATION_FEED_REFRESH_MS,
  type NotificationFeedPayload,
} from "@/lib/notificationFeedClient";
import NotificationCenterPanel from "./NotificationCenterPanel";

type Props = {
  count?: number;
  className?: string;
};

export default function NotificationBell({ count = 0, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(count);
  const [feed, setFeed] = useState<NotificationFeedPayload | null>(null);
  const [feedLoading, setFeedLoading] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    setVisibleCount(count);
  }, [count]);

  const refreshNotifications = useCallback(async (opts?: { silent?: boolean }) => {
    const panelOpen = openRef.current;
    if (!opts?.silent && panelOpen) setFeedLoading(true);
    try {
      const data = await fetchNotificationFeed();
      if (!data) return;
      if (Number.isFinite(data.unreadCount)) {
        setVisibleCount(Math.max(0, Number(data.unreadCount)));
      }
      if (panelOpen) setFeed(data);
    } catch {
      // Keep the last known count/feed when a background refresh fails.
    } finally {
      if (!opts?.silent && panelOpen) setFeedLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    const run = (silent = true) => {
      if (active) void refreshNotifications({ silent });
    };

    run(false);
    const timer = window.setInterval(() => run(true), NOTIFICATION_FEED_REFRESH_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") run(true);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshNotifications]);

  useEffect(() => {
    if (!open) {
      setFeed(null);
      return;
    }
    void refreshNotifications({ silent: false });
  }, [open, refreshNotifications]);

  const patchFeed = useCallback((patch: (prev: NotificationFeedPayload) => NotificationFeedPayload) => {
    setFeed((prev) => (prev ? patch(prev) : prev));
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
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
      </button>
      <NotificationCenterPanel
        open={open}
        anchorRef={buttonRef}
        onClose={() => setOpen(false)}
        initialCount={visibleCount}
        onCountChange={setVisibleCount}
        feed={feed}
        loading={feedLoading}
        onFeedPatch={patchFeed}
        onRefresh={refreshNotifications}
      />
    </>
  );
}

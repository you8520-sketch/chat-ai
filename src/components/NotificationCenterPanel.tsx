"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { NotificationFeedPayload } from "@/lib/notificationFeedClient";
import {
  notificationHref,
  notificationIcon,
  type NoticeFeedRow,
} from "@/lib/userNotificationPresentation";

type TabId = "activities" | "notices";

type Props = {
  open: boolean;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  initialCount: number;
  onCountChange: (count: number) => void;
  feed: NotificationFeedPayload | null;
  loading: boolean;
  onFeedPatch: (patch: (prev: NotificationFeedPayload) => NotificationFeedPayload) => void;
  onRefresh: (opts?: { silent?: boolean }) => Promise<void>;
};

function formatDate(iso: string) {
  return new Date(iso + "Z").toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={`h-4 w-4 shrink-0 text-zinc-500 transition ${open ? "rotate-180" : ""}`}
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function NotificationCenterPanel({
  open,
  anchorRef,
  onClose,
  initialCount,
  onCountChange,
  feed,
  loading,
  onFeedPatch,
  onRefresh,
}: Props) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);
  const [tab, setTab] = useState<TabId>("activities");
  const [expandedNoticeId, setExpandedNoticeId] = useState<number | null>(null);
  const [panelStyle, setPanelStyle] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 384,
  });

  const syncScrollTop = useCallback(() => {
    if (scrollRef.current) scrollTopRef.current = scrollRef.current.scrollTop;
  }, []);

  const markNoticeRead = useCallback(
    async (noticeId: number) => {
      onFeedPatch((prev) => {
        const recentNotices = prev.recentNotices.map((notice) =>
          notice.id === noticeId ? { ...notice, unread: false } : notice
        );
        const unreadCount = Math.max(0, prev.unreadCount - 1);
        onCountChange(unreadCount);
        return { ...prev, recentNotices, unreadCount };
      });
      try {
        await fetch("/api/notifications/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ noticeId }),
        });
      } catch {
        void onRefresh({ silent: true });
      }
    },
    [onCountChange, onFeedPatch, onRefresh]
  );

  const markActivityRead = useCallback(
    async (activityId: number) => {
      onFeedPatch((prev) => {
        const unreadCount = Math.max(0, prev.unreadCount - 1);
        onCountChange(unreadCount);
        return {
          ...prev,
          activities: prev.activities.filter((activity) => activity.id !== activityId),
          unreadCount,
        };
      });
      try {
        await fetch("/api/notifications/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activityId }),
        });
      } catch {
        void onRefresh({ silent: true });
      }
    },
    [onCountChange, onFeedPatch, onRefresh]
  );

  const toggleNotice = useCallback(
    (notice: NoticeFeedRow) => {
      setExpandedNoticeId((current) => {
        const next = current === notice.id ? null : notice.id;
        if (next !== null && notice.unread) void markNoticeRead(notice.id);
        return next;
      });
    },
    [markNoticeRead]
  );

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(400, Math.max(320, viewportWidth - 24));
    const left = Math.min(Math.max(12, rect.right - width), viewportWidth - width - 12);
    const top = Math.min(rect.bottom + 8, viewportHeight - 24);
    setPanelStyle({ top, left, width });
  }, [anchorRef]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onResize = () => updatePosition();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const root = rootRef.current;
      const anchor = anchorRef.current;
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (root?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("touchstart", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("touchstart", onPointer);
    };
  }, [anchorRef, onClose, open]);

  useEffect(() => {
    if (!open) {
      setExpandedNoticeId(null);
      scrollTopRef.current = 0;
    }
  }, [open]);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollTopRef.current;
    });
  }, [feed]);

  if (!open) return null;

  const notices = feed?.recentNotices ?? [];
  const activities = feed?.activities ?? [];
  const emptyActivities = !loading && activities.length === 0;
  const emptyNotices = !loading && notices.length === 0;

  return (
    <div
      ref={rootRef}
      id={panelId}
      role="dialog"
      aria-label="알림 센터"
      className="fixed z-[60] overflow-hidden rounded-2xl border border-white/10 bg-[#11131a] shadow-2xl shadow-black/50"
      style={{
        top: panelStyle.top,
        left: panelStyle.left,
        width: panelStyle.width,
        maxHeight: "min(70vh, 520px)",
      }}
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-zinc-50">알림 센터</p>
          {initialCount > 0 && (
            <p className="text-[11px] text-zinc-500">읽지 않음 {initialCount}건</p>
          )}
        </div>
        <Link
          href="/notifications"
          onClick={onClose}
          className="text-xs font-medium text-violet-300 transition hover:text-violet-200"
        >
          전체 보기
        </Link>
      </div>

      <div className="flex border-b border-white/[0.06] px-2">
        <button
          type="button"
          onClick={() => setTab("activities")}
          className={`flex-1 px-3 py-2.5 text-sm font-semibold transition ${
            tab === "activities"
              ? "border-b-2 border-violet-400 text-violet-200"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          알림
        </button>
        <button
          type="button"
          onClick={() => setTab("notices")}
          className={`flex-1 px-3 py-2.5 text-sm font-semibold transition ${
            tab === "notices"
              ? "border-b-2 border-violet-400 text-violet-200"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          공지사항
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={syncScrollTop}
        className="overflow-y-auto overscroll-contain px-2 py-2"
        style={{ maxHeight: "calc(min(70vh, 520px) - 108px)" }}
      >
        {loading && !feed && <p className="px-3 py-8 text-center text-sm text-zinc-500">불러오는 중…</p>}

        {tab === "activities" && (
          <div className="space-y-1.5">
            {emptyActivities && (
              <p className="px-3 py-10 text-center text-sm text-zinc-500">새 알림이 없습니다.</p>
            )}
            {activities.map((activity) => {
              const icon = notificationIcon(activity.type);
              const href = notificationHref(activity);
              const showCharacterAvatar = activity.type === "creator_character";
              return (
                <Link
                  key={activity.id}
                  href={href}
                  onClick={() => {
                    void markActivityRead(activity.id);
                    onClose();
                  }}
                  className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition hover:border-violet-400/30 hover:bg-white/[0.04]"
                >
                  {showCharacterAvatar ? (
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg"
                      style={{ background: `hsl(${activity.hue ?? 260} 60% 20%)` }}
                    >
                      {activity.emoji ?? icon}
                    </div>
                  ) : (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-lg">
                      {icon}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-zinc-50">{activity.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">{activity.body}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">{formatDate(activity.created_at)}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {tab === "notices" && (
          <div className="space-y-1.5">
            {emptyNotices && (
              <p className="px-3 py-10 text-center text-sm text-zinc-500">등록된 공지가 없습니다.</p>
            )}
            {notices.map((notice) => {
              const expanded = expandedNoticeId === notice.id;
              return (
                <article
                  key={notice.id}
                  className={`rounded-xl border bg-white/[0.02] transition ${
                    notice.unread ? "border-violet-400/25" : "border-white/[0.06]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleNotice(notice)}
                    className="flex w-full items-start gap-2 px-3 py-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        {notice.unread && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-400" aria-hidden />
                        )}
                        <p className="text-sm font-semibold text-zinc-50">{notice.title}</p>
                      </div>
                      <p className="mt-1 pl-4 text-[11px] text-zinc-500">{formatDate(notice.created_at)}</p>
                    </div>
                    <Chevron open={expanded} />
                  </button>
                  {expanded && (
                    <div className="border-t border-white/[0.06] px-3 pb-3 pt-2">
                      <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
                        {notice.content}
                      </p>
                      <Link
                        href={`/notices/${notice.id}`}
                        onClick={onClose}
                        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-violet-300 transition hover:text-violet-200"
                      >
                        상세보기
                        <span aria-hidden>&gt;</span>
                      </Link>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

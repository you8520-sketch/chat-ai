"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { IconBookmark } from "@/components/ChatToolbarIcons";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  bookmarkContentPreview,
  formatBookmarkChatLabel,
  type UserBookmarkRow,
} from "@/lib/bookmarks";
import { formatChatListTime } from "@/lib/recentChats";

type Props = {
  variant?: "button" | "rail" | "inline";
  align?: "left" | "right";
};

export default function BookmarksPanel({ variant = "button", align = "right" }: Props) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<UserBookmarkRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [removeTarget, setRemoveTarget] = useState<UserBookmarkRow | null>(null);

  const loadBookmarks = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/chat/bookmarks");
      const data = (await res.json()) as { bookmarks?: UserBookmarkRow[]; error?: string };
      if (!res.ok) throw new Error(data.error || "북마크를 불러오지 못했습니다.");
      setBookmarks(data.bookmarks ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadBookmarks();
  }, [open, loadBookmarks]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    if (!open) return;
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function removeBookmark(messageId: number) {
    setBusyId(messageId);
    try {
      const res = await fetch("/api/chat/bookmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return;
      if (!data.bookmarked) {
        setBookmarks((prev) => prev.filter((b) => b.message_id !== messageId));
      }
    } finally {
      setBusyId(null);
      setRemoveTarget(null);
    }
  }

  function goToBookmark(b: UserBookmarkRow) {
    setOpen(false);
    router.push(`/chat/${b.character_id}?chat=${b.chat_id}&msg=${b.message_id}`);
  }

  const countLabel = bookmarks.length > 0 ? `${bookmarks.length}개` : "";

  const triggerClass =
    variant === "rail"
      ? `flex w-full flex-col items-center gap-0.5 rounded-md px-0 py-1.5 transition hover:bg-white/[0.06] ${
          open
            ? "bg-white/[0.06] font-semibold text-amber-200"
            : "text-zinc-100 hover:text-amber-100"
        }`
      : variant === "inline"
        ? `flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition hover:bg-white/[0.06] ${
            open
              ? "bg-white/[0.06] text-amber-200"
              : "text-amber-300/90 hover:text-amber-200"
          }`
      : `rounded-lg border px-4 py-2 text-sm font-semibold transition ${
          open
            ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
            : "border-amber-500/30 bg-amber-500/10 text-amber-300 hover:border-amber-500/50 hover:bg-amber-500/15"
        }`;

  const flyoutClass =
    variant === "rail"
      ? "absolute bottom-auto right-full top-0 z-50 flex max-h-[calc(100dvh-6rem)] w-[min(19rem,calc(100vw-3.5rem))] flex-col border border-white/10 bg-[#161616] shadow-[-12px_0_32px_rgba(0,0,0,0.55)] motion-safe:animate-[settings-flyout-in_0.18s_ease-out]"
      : variant === "inline"
        ? "mt-1.5 flex max-h-[min(40dvh,16rem)] w-full flex-col rounded-lg border border-amber-500/25 bg-[#141210]"
      : `absolute top-full z-50 mt-1.5 w-[min(calc(100vw-1.5rem),20rem)] rounded-lg border border-amber-500/25 bg-[#141210] shadow-xl ${
          align === "right" ? "right-0" : "left-0"
        }`;

  return (
    <>
      <div
        ref={rootRef}
        className={
          variant === "rail"
            ? "relative flex w-full flex-col"
            : variant === "inline"
              ? "w-full"
              : "relative shrink-0"
        }
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={triggerClass}
          aria-expanded={open}
          aria-haspopup="dialog"
          title="북마크"
        >
          {variant === "rail" ? (
            <>
              <IconBookmark className="h-4 w-4" />
              <span className="max-w-full px-0.5 text-center text-[9px] font-medium leading-[1.15] tracking-tight">
                북마크
              </span>
            </>
          ) : variant === "inline" ? (
            <>
              <IconBookmark className="h-4 w-4" />
              <span>북마크{countLabel ? ` · ${countLabel}` : ""}</span>
            </>
          ) : (
            <>북마크{countLabel && open ? ` ${countLabel}` : ""}</>
          )}
        </button>

        {open && (
          <div role="dialog" aria-label="북마크 목록" className={flyoutClass}>
            <div
              className={`flex shrink-0 items-center justify-between gap-2 border-b px-2.5 py-1.5 ${
                variant === "rail" ? "border-white/10" : "border-amber-500/15"
              }`}
            >
              <span className="text-[11px] font-semibold text-amber-100/90">
                북마크{countLabel ? ` · ${countLabel}` : ""}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              >
                닫기
              </button>
            </div>

            <div
              className={`min-h-0 overflow-y-auto p-2 scrollbar-hide ${
                variant === "rail" || variant === "inline" ? "flex-1" : "max-h-[min(24rem,58dvh)]"
              }`}
            >
              {loading && bookmarks.length === 0 ? (
                <p className="py-3 text-center text-[10px] text-zinc-500">불러오는 중…</p>
              ) : error ? (
                <p className="py-3 text-center text-[10px] text-rose-400">{error}</p>
              ) : bookmarks.length === 0 ? (
                <p className="py-4 text-center text-[10px] leading-relaxed text-zinc-500">
                  저장한 북마크가 없습니다.
                  <br />
                  채팅 메시지 하단에서 저장할 수 있습니다.
                </p>
              ) : (
                <ul className="space-y-1">
                  {bookmarks.map((b) => {
                    const chatLabel = formatBookmarkChatLabel(b);
                    const preview = bookmarkContentPreview(b.content);
                    const when = formatChatListTime(b.created_at);
                    const roleLabel = b.role === "user" ? "나" : b.character_name;
                    const metaParts = [
                      `${b.character_emoji} ${b.character_name}`,
                      chatLabel !== b.character_name ? chatLabel : "",
                      when || "",
                    ].filter(Boolean);

                    return (
                      <li
                        key={b.message_id}
                        className="rounded-md border border-white/8 bg-[#131626] px-2 py-1.5"
                      >
                        <div className="flex items-start gap-1.5">
                          <button
                            type="button"
                            onClick={() => goToBookmark(b)}
                            className="min-w-0 flex-1 text-left hover:opacity-95"
                          >
                            <p className="line-clamp-2 text-[11px] font-medium leading-snug text-amber-200/80">
                              {b.title || "북마크"}
                            </p>
                            <p className="truncate text-[9px] leading-tight text-zinc-500">
                              {metaParts.join(" · ")}
                            </p>
                            {preview ? (
                              <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-zinc-400">
                                <span className="text-zinc-600">{roleLabel}: </span>
                                {preview}
                              </p>
                            ) : null}
                          </button>
                          <div className="flex shrink-0 flex-col gap-0.5">
                            <button
                              type="button"
                              onClick={() => goToBookmark(b)}
                              className="rounded border border-violet-500/35 bg-violet-600/90 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-violet-500"
                            >
                              보기
                            </button>
                            <button
                              type="button"
                              disabled={busyId === b.message_id}
                              onClick={() => setRemoveTarget(b)}
                              className="rounded border border-white/10 px-2 py-0.5 text-[9px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300 disabled:opacity-50"
                            >
                              삭제
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {removeTarget && (
        <ConfirmDialog
          open
          title="북마크 삭제"
          message={`「${removeTarget.title || "북마크"}」을 목록에서 삭제할까요?`}
          confirmLabel="삭제"
          danger
          onCancel={() => setRemoveTarget(null)}
          onConfirm={() => void removeBookmark(removeTarget.message_id)}
        />
      )}
    </>
  );
}

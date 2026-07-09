"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import ChatRoomDisplayQuickRail from "@/components/ChatRoomDisplayQuickRail";
import type { ChatDisplayPrefs } from "@/lib/chatDisplayPrefs";

type Props = {
  displayPrefs: ChatDisplayPrefs;
  onDisplayPrefsChange: (prefs: ChatDisplayPrefs) => void;
  settingsPanel: ReactNode;
  bookmarksPanel: ReactNode;
};

/** md 미만: 채팅 메뉴(에셋·페르소나·노트 등)를 시트에 모아 표시 */
export default function ChatRoomMobileMenu({
  displayPrefs,
  onDisplayPrefsChange,
  settingsPanel,
  bookmarksPanel,
}: Props) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-200 transition hover:bg-white/[0.08] hover:text-white"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="채팅 메뉴"
        title="채팅 메뉴"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5" aria-hidden>
          <circle cx="12" cy="5" r="1.25" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
          <circle cx="12" cy="19" r="1.25" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[60] md:hidden" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="메뉴 닫기"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="absolute inset-x-0 bottom-0 flex max-h-[min(88dvh,40rem)] flex-col rounded-t-2xl border border-white/10 bg-[#121212] shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
              <p id={titleId} className="text-sm font-bold text-white">
                채팅 메뉴
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-2.5 py-1 text-xs font-semibold text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              >
                닫기
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="border-b border-white/5 px-3 py-2">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  표시
                </p>
                <div className="flex items-stretch gap-2">
                  <div className="w-16 shrink-0 rounded-lg border border-white/10 bg-[#161616] px-1 py-1">
                    <ChatRoomDisplayQuickRail
                      displayPrefs={displayPrefs}
                      onDisplayPrefsChange={onDisplayPrefsChange}
                    />
                  </div>
                  <div className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#161616] px-2 py-1">
                    {bookmarksPanel}
                  </div>
                </div>
              </div>

              <div className="min-h-[18rem]">{settingsPanel}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useState, type ReactNode } from "react";
import ChatRoomDisplayQuickRail from "@/components/ChatRoomDisplayQuickRail";
import type { ChatDisplayPrefs } from "@/lib/chatDisplayPrefs";

type Props = {
  displayPrefs: ChatDisplayPrefs;
  onDisplayPrefsChange: (prefs: ChatDisplayPrefs) => void;
  settingsPanel: ReactNode;
  bookmarksPanel: ReactNode;
};

/** md 미만: ... 버튼을 눌렀을 때 우측 세로 레일에 표시·설정·북마크를 함께 배치 */
export default function ChatRoomMobileMenu({
  displayPrefs,
  onDisplayPrefsChange,
  settingsPanel,
  bookmarksPanel,
}: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
            className="absolute inset-0 bg-black/25"
            aria-label="메뉴 닫기"
            onClick={() => setOpen(false)}
          />
          <aside
            className="absolute right-1 top-[4.25rem] z-10 flex w-11 flex-col gap-1 rounded-xl border border-white/10 bg-[#101010]/95 px-1 py-1 shadow-[-10px_0_28px_rgba(0,0,0,0.45)] backdrop-blur"
            aria-label="채팅 메뉴"
          >
            <ChatRoomDisplayQuickRail
              displayPrefs={displayPrefs}
              onDisplayPrefsChange={onDisplayPrefsChange}
            />
            {settingsPanel}
            {bookmarksPanel}

            {displayPrefs.showCharacterPortrait ? (
              <label className="mt-1 flex flex-col items-center gap-1 border-t border-white/10 pt-1 text-[9px] font-medium leading-[1.15] text-zinc-300">
                <span className="text-center">배경</span>
                <span className="text-violet-300">
                  {Math.round(displayPrefs.portraitBackgroundOpacity * 100)}%
                </span>
                <input
                  type="range"
                  aria-label="모바일 배경 이미지 투명도"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(displayPrefs.portraitBackgroundOpacity * 100)}
                  onChange={(e) =>
                    onDisplayPrefsChange({
                      ...displayPrefs,
                      portraitBackgroundOpacity: Number(e.target.value) / 100,
                    })
                  }
                  className="h-16 w-5 [writing-mode:vertical-lr] accent-violet-500"
                />
              </label>
            ) : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

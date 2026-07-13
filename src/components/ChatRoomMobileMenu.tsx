"use client";

import { type ReactNode } from "react";
import ChatRoomDisplayQuickRail from "@/components/ChatRoomDisplayQuickRail";
import type { ChatDisplayPrefs } from "@/lib/chatDisplayPrefs";

type Props = {
  displayPrefs: ChatDisplayPrefs;
  onDisplayPrefsChange: (prefs: ChatDisplayPrefs) => void;
  settingsPanel: ReactNode;
  bookmarksPanel: ReactNode;
};

/** md 미만: 데스크톱과 같은 우측 세로 레일에 표시·설정·북마크를 함께 배치 */
export default function ChatRoomMobileMenu({
  displayPrefs,
  onDisplayPrefsChange,
  settingsPanel,
  bookmarksPanel,
}: Props) {
  return (
    <aside
      className="fixed right-1 top-[4.25rem] z-50 flex w-11 flex-col gap-1 rounded-xl border border-white/10 bg-[#101010]/95 px-1 py-1 shadow-[-10px_0_28px_rgba(0,0,0,0.45)] backdrop-blur md:hidden"
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
  );
}

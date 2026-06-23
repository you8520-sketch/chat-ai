"use client";

import type { ChatDisplayPrefs } from "@/lib/chatDisplayPrefs";

export function PortraitAssetToggleRow({
  enabled,
  onChange,
  compact = false,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  compact?: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#1a1a1a] ${
        compact ? "px-2.5 py-2" : "px-3 py-2.5"
      }`}
    >
      <div className="min-w-0">
        <span className={`block text-zinc-300 ${compact ? "text-[11px]" : ""}`}>이미지 에셋 표시</span>
        {!compact && (
          <span className="mt-0.5 block text-[10px] text-zinc-600">
            끄면 왼쪽 초상을 숨기고 채팅 영역을 넓게 씁니다
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => onChange(!enabled)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          enabled ? "bg-violet-600" : "bg-gray-700"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
            enabled ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </label>
  );
}

export function ChatPortraitPrefs({
  displayPrefs,
  onDisplayPrefsChange,
}: {
  displayPrefs: ChatDisplayPrefs;
  onDisplayPrefsChange: (prefs: ChatDisplayPrefs) => void;
}) {
  return (
    <div className="space-y-5 text-xs">
      <section>
        <p className="mb-2 font-bold text-violet-300">이미지 에셋</p>
        <p className="mb-2 text-[10px] text-zinc-600">
          왼쪽 감정 초상 · 변경 즉시 반영 (이 기기)
        </p>
        <PortraitAssetToggleRow
          enabled={displayPrefs.showCharacterPortrait}
          onChange={(on) => onDisplayPrefsChange({ ...displayPrefs, showCharacterPortrait: on })}
        />
      </section>
    </div>
  );
}

/** @deprecated use ChatPortraitPrefs */
export const ChatStatusPortraitPrefs = ChatPortraitPrefs;

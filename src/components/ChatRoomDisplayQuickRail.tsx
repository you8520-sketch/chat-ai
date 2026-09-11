"use client";

import {
  CHAT_ASSET_DISPLAY_MODE_LABELS,
  CHAT_ASSET_DISPLAY_MODES,
  type ChatDisplayPrefs,
} from "@/lib/chatDisplayPrefs";

function IconPortrait({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className={className}
      aria-hidden
    >
      <rect x="3" y="4" width="8" height="10" rx="1.5" />
      <path strokeLinecap="round" d="M3 18h8" />
      <circle cx="17" cy="9" r="3" />
      <path strokeLinecap="round" d="M13 17c0-2.2 1.8-4 4-4s4 1.8 4 4" />
    </svg>
  );
}

type Props = {
  displayPrefs: ChatDisplayPrefs;
  onDisplayPrefsChange: (prefs: ChatDisplayPrefs) => void;
};

/**
 * Canonical 3-state asset display cycle: 좌측 → 본문 → OFF → 좌측.
 * One persisted value (`assetDisplayMode`); current state is always shown.
 */
export default function ChatRoomDisplayQuickRail({
  displayPrefs,
  onDisplayPrefsChange,
}: Props) {
  const current = displayPrefs.assetDisplayMode;
  const index = CHAT_ASSET_DISPLAY_MODES.indexOf(current);
  const next = CHAT_ASSET_DISPLAY_MODES[(index + 1) % CHAT_ASSET_DISPLAY_MODES.length]!;
  const currentLabel = CHAT_ASSET_DISPLAY_MODE_LABELS[current];
  const nextLabel = CHAT_ASSET_DISPLAY_MODE_LABELS[next];
  const isOff = current === "off";

  return (
    <button
      type="button"
      title={`캐릭터 에셋 표시: ${currentLabel} · 클릭하여 ${nextLabel}(으)로 전환`}
      aria-label={`캐릭터 에셋 표시 ${currentLabel}, 클릭하면 ${nextLabel}(으)로 전환`}
      onClick={() =>
        onDisplayPrefsChange({
          ...displayPrefs,
          assetDisplayMode: next,
        })
      }
      className={`flex w-full flex-col items-center gap-0.5 rounded-md px-0 py-1.5 transition hover:bg-white/[0.06] ${
        isOff ? "text-zinc-400 hover:text-zinc-200" : "font-semibold text-violet-200"
      }`}
    >
      <IconPortrait className="h-4 w-4 shrink-0" />
      <span className="max-w-full px-0.5 text-center text-[9px] font-medium leading-[1.15] tracking-tight">
        {currentLabel}
      </span>
    </button>
  );
}

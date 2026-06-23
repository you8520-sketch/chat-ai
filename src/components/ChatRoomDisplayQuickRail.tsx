"use client";

import type { ChatDisplayPrefs } from "@/lib/chatDisplayPrefs";

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

export default function ChatRoomDisplayQuickRail({
  displayPrefs,
  onDisplayPrefsChange,
}: Props) {
  const on = displayPrefs.showCharacterPortrait;
  const label = on ? "에셋ON" : "에셋OFF";

  return (
    <button
      type="button"
      title={`왼쪽 감정 초상 ${on ? "표시" : "숨김"} · 클릭하여 전환`}
      aria-pressed={on}
      aria-label={label}
      onClick={() =>
        onDisplayPrefsChange({
          ...displayPrefs,
          showCharacterPortrait: !on,
        })
      }
      className={`flex w-full flex-col items-center gap-0.5 rounded-md px-0 py-1.5 transition hover:bg-white/[0.06] ${
        on ? "font-semibold text-violet-200" : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      <IconPortrait className="h-4 w-4 shrink-0" />
      <span className="max-w-full px-0.5 text-center text-[9px] font-medium leading-[1.15] tracking-tight">
        {label}
      </span>
    </button>
  );
}

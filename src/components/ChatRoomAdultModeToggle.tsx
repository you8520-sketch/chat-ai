"use client";

import {
  CHAT_ADULT_MODE_LABEL,
  CHAT_ADULT_MODE_OFF_HINT,
  CHAT_ADULT_MODE_ON_HINT,
  CHAT_ADULT_MODE_VERIFY_HINT,
} from "@/lib/chatAdultHandoff";

export default function ChatRoomAdultModeToggle({
  isAdult,
  enabled,
  busy = false,
  onToggle,
}: {
  isAdult: boolean;
  enabled: boolean;
  busy?: boolean;
  onToggle: () => void;
}) {
  const title = isAdult
    ? enabled
      ? CHAT_ADULT_MODE_OFF_HINT
      : CHAT_ADULT_MODE_ON_HINT
    : CHAT_ADULT_MODE_VERIFY_HINT;

  return (
    <div
      className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-white/10 bg-[#1a1a1a] px-1.5"
      title={title}
    >
      <span className="text-[11px] font-semibold text-zinc-400">{CHAT_ADULT_MODE_LABEL}</span>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={enabled}
        aria-label={title}
        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
          enabled ? "bg-violet-500" : "bg-zinc-700"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
            enabled ? "left-[14px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

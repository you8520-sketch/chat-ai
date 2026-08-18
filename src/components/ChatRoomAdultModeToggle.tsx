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
      className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-[#161922] px-2 py-1"
      title={title}
    >
      <span className="text-[10px] font-medium text-zinc-300">{CHAT_ADULT_MODE_LABEL}</span>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={enabled}
        aria-label={title}
        className={`relative h-5 w-8 shrink-0 rounded-full transition-colors disabled:opacity-40 sm:w-9 ${
          enabled ? "bg-violet-500" : "bg-zinc-700"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
            enabled ? "left-[14px] sm:left-[18px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

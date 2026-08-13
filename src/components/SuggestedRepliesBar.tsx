"use client";

import { SUGGESTED_REPLIES_CAPTION } from "@/lib/suggestedReplies/types";

export function SuggestedRepliesBar({
  replies,
  pending,
  disabled,
  onPick,
  onDisable,
}: {
  replies: string[];
  pending: boolean;
  disabled?: boolean;
  onPick: (text: string) => void;
  onDisable: () => void;
}) {
  if (!pending && replies.length === 0) return null;

  return (
    <div className="mb-1.5 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-[10px] leading-relaxed text-zinc-500">
          {SUGGESTED_REPLIES_CAPTION}
        </p>
        <button
          type="button"
          onClick={onDisable}
          className="shrink-0 text-[10px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
        >
          끄기
        </button>
      </div>
      {pending && replies.length === 0 ? (
        <p className="text-[10px] text-zinc-600">추천 메시지 준비 중…</p>
      ) : (
        <div className="flex flex-col gap-1">
          {replies.map((text) => (
            <button
              key={text}
              type="button"
              disabled={disabled}
              onClick={() => onPick(text)}
              className="rounded-lg border border-white/10 bg-[#1a1a1a] px-2.5 py-1.5 text-left text-[11px] leading-relaxed text-zinc-200 hover:border-violet-400/40 hover:bg-violet-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

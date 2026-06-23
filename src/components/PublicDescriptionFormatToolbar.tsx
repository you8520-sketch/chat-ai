"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  repairProfileInlineFormatMarkup,
  profileBoldWrap,
  profileColorWrap,
  profileSizeDecrease,
  profileSizeIncrease,
  PROFILE_TEXT_COLOR_CLASS,
  PROFILE_TEXT_COLORS,
  type ProfileTextColor,
  wrapTextareaSelection,
} from "@/lib/profileTextFormat";

const COLOR_LABELS: Record<ProfileTextColor, string> = {
  emerald: "초록",
  violet: "보라",
  cyan: "하늘",
  rose: "분홍",
  amber: "노랑",
  white: "흰색",
};

const btnCls =
  "rounded-lg border border-violet-500/40 bg-[#12152a] px-2.5 py-1.5 text-xs font-bold text-violet-100 transition hover:border-violet-400/70 hover:bg-violet-500/15 disabled:opacity-40";

type Props = {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  maxLength: number;
};

export default function PublicDescriptionFormatToolbar({
  textareaRef,
  value,
  onChange,
  maxLength,
}: Props) {
  const [colorOpen, setColorOpen] = useState(false);
  const colorMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!colorOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!colorMenuRef.current?.contains(e.target as Node)) {
        setColorOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [colorOpen]);

  function apply(wrap: (selected: string) => string) {
    wrapTextareaSelection(textareaRef.current, value, (next) => {
      onChange(repairProfileInlineFormatMarkup(next).slice(0, maxLength));
    }, wrap);
    setColorOpen(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-violet-500/30 bg-[#0a0d18] p-2">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-violet-400/90">
        선택 영역
      </span>
      <button
        type="button"
        className={btnCls}
        title="굵게"
        onClick={() => apply(profileBoldWrap)}
      >
        굵게
      </button>
      <button
        type="button"
        className={btnCls}
        title="글자 크게 (한 단계씩 · 최대 아주 큼)"
        onClick={() => apply(profileSizeIncrease)}
      >
        크게
      </button>
      <button
        type="button"
        className={btnCls}
        title="글자 작게 (한 단계씩)"
        onClick={() => apply(profileSizeDecrease)}
      >
        작게
      </button>
      <div className="relative" ref={colorMenuRef}>
        <button
          type="button"
          className={btnCls}
          title="글자색"
          onClick={() => setColorOpen((v) => !v)}
        >
          색상 ▾
        </button>
        {colorOpen ? (
          <div className="absolute left-0 top-full z-20 mt-1 flex flex-wrap gap-1 rounded-xl border border-violet-500/40 bg-[#12152a] p-2 shadow-xl shadow-black/40">
            {(Object.keys(PROFILE_TEXT_COLORS) as ProfileTextColor[]).map((color) => (
              <button
                key={color}
                type="button"
                className={`rounded-md border border-white/10 px-2 py-1 text-[11px] font-semibold ${PROFILE_TEXT_COLOR_CLASS[color]} hover:bg-white/5`}
                onClick={() => apply((t) => profileColorWrap(t, color))}
              >
                {COLOR_LABELS[color]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <p className="ml-auto hidden text-[10px] text-gray-500 sm:block">
        드래그로 선택 후 버튼 · 미리보기에 반영
      </p>
    </div>
  );
}

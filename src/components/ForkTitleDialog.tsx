"use client";

import { useEffect, useState } from "react";

import { CHAT_TITLE_MAX } from "@/lib/chatTitle";

type Props = {
  open: boolean;
  defaultTitle: string;
  onConfirm: (title: string) => void;
  onCancel: () => void;
};

export default function ForkTitleDialog({ open, defaultTitle, onConfirm, onCancel }: Props) {
  const [title, setTitle] = useState(defaultTitle);

  useEffect(() => {
    if (open) setTitle(defaultTitle);
  }, [open, defaultTitle]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/65 p-4"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fork-title-dialog"
        className="w-full max-w-sm rounded-xl border border-white/10 bg-[#1a1a1a] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="fork-title-dialog" className="text-base font-bold text-white">
          분기 대화 만들기
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          이 시점부터 새 대화방이 갈라집니다. 분기 제목을 지어 주세요.
        </p>
        <input
          type="text"
          value={title}
          maxLength={CHAT_TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="예: 루트 A, 재회 후"
          className="mt-4 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-violet-500/50"
          autoFocus
        />
        <p className="mt-1 text-right text-[10px] text-zinc-600">
          {title.length}/{CHAT_TITLE_MAX}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-300 hover:bg-white/10"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => onConfirm(title.trim())}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
          >
            분기 생성
          </button>
        </div>
      </div>
    </div>
  );
}

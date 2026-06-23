"use client";

import { useEffect, useState } from "react";

import { BOOKMARK_TITLE_MAX } from "@/lib/bookmarks";

type Props = {
  open: boolean;
  defaultTitle: string;
  onConfirm: (title: string) => void;
  onCancel: () => void;
};

export default function BookmarkTitleDialog({ open, defaultTitle, onConfirm, onCancel }: Props) {
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
        aria-labelledby="bookmark-title-dialog"
        className="w-full max-w-sm rounded-xl border border-white/10 bg-[#1a1a1a] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="bookmark-title-dialog" className="text-base font-bold text-white">북마크 저장</p>
        <p className="mt-2 text-sm text-zinc-400">
          이 대화를 북마크에 추가합니다. 나중에 찾기 쉬운 제목을 적어 주세요.
        </p>
        <input
          type="text"
          value={title}
          maxLength={BOOKMARK_TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="예: 첫 키스 직전, 분기 결정 장면"
          className="mt-4 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-amber-500/50"
          autoFocus
        />
        <p className="mt-1 text-right text-[10px] text-zinc-600">
          {title.length}/{BOOKMARK_TITLE_MAX}
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
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500"
          >
            북마크
          </button>
        </div>
      </div>
    </div>
  );
}

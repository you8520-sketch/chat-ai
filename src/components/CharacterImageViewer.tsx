"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 캐릭터 대표 이미지 뷰어.
 * - 본문: 원본 비율 유지(object-contain) — 얼굴/전신이 잘리지 않음
 * - 이미지가 차지하는 폭만 프레임으로 잡아 좌우 빈 배경이 남지 않음
 * - 클릭 시: 뷰포트에 맞춘 확대 모달(원본 비율 유지)
 */
export default function CharacterImageViewer({
  src,
  alt,
}: {
  src: string;
  alt: string;
  hue: number;
}) {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative mx-auto block w-fit max-w-full overflow-hidden rounded-2xl bg-transparent"
        aria-label="이미지 크게 보기"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="block h-auto max-h-[70vh] w-auto max-w-full object-contain"
        />
        <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/60 px-2 py-1 text-[10px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
          클릭하여 확대
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
          onClick={close}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={close}
            className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1.5 text-sm font-bold text-white hover:bg-white/20"
            aria-label="닫기"
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="max-h-[92vh] max-w-[92vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CharacterAssetImage from "@/components/CharacterAssetImage";
import { shouldBlurAssetForViewer, type CharacterAsset } from "@/lib/characterAssets";

type Props = {
  open: boolean;
  assets: CharacterAsset[];
  initialIndex: number;
  characterName: string;
  viewerIsCreator: boolean;
  unlockedUrls: ReadonlySet<string>;
  onClose: () => void;
};

const SWIPE_THRESHOLD = 48;

export default function CharacterAssetGalleryLightbox({
  open,
  assets,
  initialIndex,
  characterName,
  viewerIsCreator,
  unlockedUrls,
  onClose,
}: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [mounted, setMounted] = useState(false);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) setIndex(initialIndex);
  }, [open, initialIndex]);

  const go = useCallback(
    (dir: -1 | 1) => {
      if (assets.length <= 1) return;
      setIndex((i) => (i + dir + assets.length) % assets.length);
    },
    [assets.length]
  );

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close, go]);

  if (!mounted || !open || assets.length === 0) return null;

  const asset = assets[index]!;
  const blur = shouldBlurAssetForViewer(asset, viewerIsCreator, unlockedUrls);
  const hasMultiple = assets.length > 1;

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.changedTouches[0]?.clientX ?? null;
  }

  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStartX.current;
    const end = e.changedTouches[0]?.clientX;
    touchStartX.current = null;
    if (start == null || end == null) return;
    const delta = end - start;
    if (Math.abs(delta) < SWIPE_THRESHOLD) return;
    go(delta > 0 ? -1 : 1);
  }

  const overlay = (
    <div
      className="fixed inset-0 z-[9999] flex h-[100dvh] w-screen flex-col bg-black"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label={`${characterName} 이미지 전체 화면`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="absolute inset-x-0 top-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent px-4 pb-8 pt-[max(0.75rem,env(safe-area-inset-top))]"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="min-w-0 truncate text-sm font-medium text-zinc-200">
          {characterName}
          {asset.tag && <span className="ml-2 text-zinc-500">{asset.tag}</span>}
        </p>
        <button
          type="button"
          onClick={close}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          aria-label="닫기"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5" aria-hidden>
            <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {hasMultiple && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            className="absolute left-3 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white/90 backdrop-blur-sm transition hover:bg-black/70 sm:left-6"
            aria-label="이전 이미지"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-7 w-7" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="m14 6-6 6 6 6" />
            </svg>
          </button>
        )}

        <div
          className="flex h-full w-full items-center justify-center px-14 sm:px-20"
          onClick={(e) => e.stopPropagation()}
        >
          <CharacterAssetImage
            key={asset.url}
            src={asset.url}
            alt={`${characterName} — ${asset.tag}`}
            blurForViewer={blur}
            className="h-full w-full"
            imgClassName="mx-auto h-full w-full max-h-[100dvh] max-w-[100vw] object-contain"
          />
        </div>

        {hasMultiple && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            className="absolute right-3 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white/90 backdrop-blur-sm transition hover:bg-black/70 sm:right-6"
            aria-label="다음 이미지"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-7 w-7" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="m10 6 6 6-6 6" />
            </svg>
          </button>
        )}
      </div>

      {hasMultiple && (
        <p
          className="absolute inset-x-0 bottom-0 z-20 pb-[max(1rem,env(safe-area-inset-bottom))] text-center text-xs text-zinc-500"
          onClick={(e) => e.stopPropagation()}
        >
          {index + 1} / {assets.length}
          <span className="mx-2 text-zinc-700">·</span>
          좌우 스와이프 또는 화살표 키
        </p>
      )}
    </div>
  );

  return createPortal(overlay, document.body);
}

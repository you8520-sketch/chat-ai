"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import ChatCharacterPortrait from "@/components/ChatCharacterPortrait";
import CharacterAssetGalleryLightbox from "@/components/CharacterAssetGalleryLightbox";
import {
  chatAssets,
  shouldBlurAssetForViewer,
  type CharacterAsset,
} from "@/lib/characterAssets";

type Props = {
  characterName: string;
  emoji: string;
  hue: number;
  assets: CharacterAsset[];
  defaultAsset: CharacterAsset | null;
  activeUrl: string | null;
  unlockedUrls: ReadonlySet<string>;
  viewerIsCreator: boolean;
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
  onActiveAssetChange: (asset: CharacterAsset) => void;
  creatorName?: string;
  creatorHref?: string;
  onCharacterIntroOpen?: () => void;
};

export default function ChatEmotionPortraitPanel({
  characterName,
  emoji,
  hue,
  assets,
  defaultAsset,
  activeUrl,
  unlockedUrls,
  viewerIsCreator,
  pinned,
  onPinnedChange,
  onActiveAssetChange,
  creatorName,
  creatorHref,
  onCharacterIntroOpen,
}: Props) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const visibleAssets = useMemo(() => {
    const pool = chatAssets(assets);
    const source = pool.length > 0 ? pool : assets;
    return source.filter(
      (asset) => viewerIsCreator || asset.viewerBlur !== true || unlockedUrls.has(asset.url)
    );
  }, [assets, unlockedUrls, viewerIsCreator]);

  const fallbackAsset =
    visibleAssets.find((asset) => asset.url === defaultAsset?.url) ?? visibleAssets[0] ?? null;
  const activeVisibleAsset = visibleAssets.find((asset) => asset.url === activeUrl) ?? null;
  const displayAsset = activeVisibleAsset ?? fallbackAsset;
  const displayUrl = displayAsset?.url ?? null;
  const blur = shouldBlurAssetForViewer(displayAsset ?? undefined, viewerIsCreator, unlockedUrls);
  const hasMultiple = visibleAssets.length > 1;
  const currentIndex = displayUrl
    ? visibleAssets.findIndex((asset) => asset.url === displayUrl)
    : -1;

  function openLightbox() {
    if (visibleAssets.length === 0) return;
    const idx = visibleAssets.findIndex((a) => a.url === displayUrl);
    setLightboxIndex(idx >= 0 ? idx : 0);
    setLightboxOpen(true);
  }

  function go(dir: -1 | 1) {
    if (!hasMultiple) return;
    const base = currentIndex >= 0 ? currentIndex : 0;
    const next = visibleAssets[(base + dir + visibleAssets.length) % visibleAssets.length];
    if (next) onActiveAssetChange(next);
  }

  return (
    <>
      <div className="flex h-full min-h-0 w-full flex-col items-center">
        <div className="flex w-full max-w-[320px] shrink-0 items-baseline gap-2 px-1 pb-1 pt-2">
          <button
            type="button"
            onClick={onCharacterIntroOpen}
            className="min-w-0 truncate text-left text-xl font-black leading-tight text-white underline-offset-4 transition hover:text-violet-100 hover:underline"
            title="캐릭터 소개 보기"
          >
            {characterName}
          </button>
          {creatorHref ? (
            <Link
              href={creatorHref}
              className="shrink-0 truncate text-xs font-medium text-zinc-500 underline-offset-2 transition hover:text-zinc-300 hover:underline"
              title="제작자 페이지"
            >
              {creatorName || "제작자"}
            </Link>
          ) : creatorName ? (
            <p className="shrink-0 truncate text-xs font-medium text-zinc-500">{creatorName}</p>
          ) : null}
        </div>

        <div className="relative flex min-h-0 w-full flex-1 flex-col items-center justify-end">
          <ChatCharacterPortrait
            characterName={characterName}
            emoji={emoji}
            hue={hue}
            portraitUrl={displayUrl}
            blurForViewer={blur}
            size="panel"
            onPortraitClick={visibleAssets.length > 0 ? openLightbox : undefined}
          />
          {visibleAssets.length > 0 && (
            <>
              <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    go(-1);
                  }}
                  disabled={!hasMultiple}
                  className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/45 text-lg font-bold text-white/90 shadow-lg shadow-black/30 backdrop-blur transition hover:bg-black/65 disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label="이전 해금 이미지"
                  title="이전 해금 이미지"
                >
                  {"<"}
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    go(1);
                  }}
                  disabled={!hasMultiple}
                  className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/45 text-lg font-bold text-white/90 shadow-lg shadow-black/30 backdrop-blur transition hover:bg-black/65 disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label="다음 해금 이미지"
                  title="다음 해금 이미지"
                >
                  {">"}
                </button>
              </div>

              <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex justify-center">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPinnedChange(!pinned);
                  }}
                  className={`pointer-events-auto rounded-full border px-2.5 py-1 text-[10px] font-bold shadow-lg shadow-black/20 backdrop-blur transition ${
                    pinned
                      ? "border-violet-300/45 bg-violet-600/65 text-white hover:bg-violet-600/80"
                      : "border-white/10 bg-black/30 text-zinc-100/85 hover:bg-black/50 hover:text-white"
                  }`}
                  aria-pressed={pinned}
                  aria-label={pinned ? "이미지 고정 해제" : "현재 이미지 고정"}
                  title={pinned ? "이미지 고정 해제" : "현재 이미지 고정"}
                >
                  {pinned ? "고정중" : "고정"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <CharacterAssetGalleryLightbox
        open={lightboxOpen}
        assets={visibleAssets}
        initialIndex={lightboxIndex}
        characterName={characterName}
        viewerIsCreator={viewerIsCreator}
        unlockedUrls={unlockedUrls}
        onClose={() => setLightboxOpen(false)}
      />
    </>
  );
}

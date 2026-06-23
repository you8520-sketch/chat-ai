"use client";

import { useMemo, useState } from "react";
import ChatCharacterPortrait from "@/components/ChatCharacterPortrait";
import CharacterAssetGalleryLightbox from "@/components/CharacterAssetGalleryLightbox";
import {
  assetByUrl,
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
}: Props) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const galleryAssets = useMemo(() => {
    const pool = chatAssets(assets);
    return pool.length > 0 ? pool : assets;
  }, [assets]);

  const displayUrl = activeUrl ?? defaultAsset?.url ?? null;
  const displayAsset = assetByUrl(assets, displayUrl) ?? defaultAsset;
  const blur = shouldBlurAssetForViewer(displayAsset ?? undefined, viewerIsCreator, unlockedUrls);

  function openLightbox() {
    if (galleryAssets.length === 0) return;
    const idx = galleryAssets.findIndex((a) => a.url === displayUrl);
    setLightboxIndex(idx >= 0 ? idx : 0);
    setLightboxOpen(true);
  }

  return (
    <>
      <div className="flex h-full min-h-0 w-full flex-col items-center justify-end">
        <ChatCharacterPortrait
          characterName={characterName}
          emoji={emoji}
          hue={hue}
          portraitUrl={displayUrl}
          blurForViewer={blur}
          size="panel"
          onPortraitClick={galleryAssets.length > 0 ? openLightbox : undefined}
        />
      </div>

      <CharacterAssetGalleryLightbox
        open={lightboxOpen}
        assets={galleryAssets}
        initialIndex={lightboxIndex}
        characterName={characterName}
        viewerIsCreator={viewerIsCreator}
        unlockedUrls={unlockedUrls}
        onClose={() => setLightboxOpen(false)}
      />
    </>
  );
}

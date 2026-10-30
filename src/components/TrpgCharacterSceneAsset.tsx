"use client";

import { useEffect, useRef, useState } from "react";
import CharacterAssetGalleryLightbox from "@/components/CharacterAssetGalleryLightbox";
import CharacterAssetImage from "@/components/CharacterAssetImage";
import { shouldBlurAssetForViewer, type CharacterAsset } from "@/lib/characterAssets";
import { trpgInlineAssetFrame } from "@/lib/trpg/trpgInlineAssetFrame";

export default function TrpgCharacterSceneAsset({
  asset,
  viewerIsCreator = false,
  unlockedUrls,
  label,
}: {
  asset: CharacterAsset;
  viewerIsCreator?: boolean;
  unlockedUrls?: ReadonlySet<string>;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const scrollYRef = useRef(0);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    const y = scrollYRef.current;
    window.scrollTo(0, y);
    buttonRef.current?.focus({ preventScroll: true });
  }, [open]);

  if (shouldBlurAssetForViewer(asset, viewerIsCreator, unlockedUrls)) {
    return null;
  }
  const frame = trpgInlineAssetFrame(asset);
  const name = label?.trim() || asset.tag;
  return (
    <>
      <figure
        data-testid="trpg-character-scene-asset"
        data-asset-tag={asset.tag}
        data-asset-orientation={frame.kind}
        className={frame.figureClassName}
        style={frame.style}
      >
        <button
          ref={buttonRef}
          type="button"
          data-trpg-inline-zoom
          aria-label={`${name} 이미지 크게 보기`}
          className="block w-full"
          onClick={() => {
            scrollYRef.current = window.scrollY;
            setOpen(true);
          }}
        >
          <CharacterAssetImage
            src={asset.url}
            alt={asset.tag}
            blurForViewer={false}
            className={frame.boxClassName}
            imgClassName={frame.imgClassName}
          />
        </button>
      </figure>
      <CharacterAssetGalleryLightbox
        open={open}
        assets={[asset]}
        initialIndex={0}
        characterName={name}
        viewerIsCreator={viewerIsCreator}
        unlockedUrls={unlockedUrls ?? new Set()}
        presentation="stage"
        onClose={() => setOpen(false)}
      />
    </>
  );
}

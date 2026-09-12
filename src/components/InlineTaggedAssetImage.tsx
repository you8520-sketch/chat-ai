"use client";

import CharacterAssetImage from "@/components/CharacterAssetImage";
import { shouldBlurAssetForViewer, type CharacterAsset } from "@/lib/characterAssets";
import {
  CHAT_INLINE_ASSET_FIGURE_CLASS,
  CHAT_INLINE_ASSET_IMG_CLASS,
} from "@/lib/chatDisplayPrefs";

export default function InlineTaggedAssetImage({
  asset,
  viewerIsCreator = false,
  unlockedUrls,
}: {
  asset: CharacterAsset;
  viewerIsCreator?: boolean;
  unlockedUrls?: ReadonlySet<string>;
}) {
  const blur = shouldBlurAssetForViewer(asset, viewerIsCreator, unlockedUrls);
  const ratio =
    asset.width && asset.height && asset.width > 0 && asset.height > 0
      ? `${asset.width} / ${asset.height}`
      : undefined;
  return (
    <figure
      data-testid="inline-tagged-asset"
      data-asset-tag={asset.tag}
      className={CHAT_INLINE_ASSET_FIGURE_CLASS}
      style={ratio ? { aspectRatio: ratio } : undefined}
    >
      <CharacterAssetImage
        src={asset.url}
        alt={asset.tag}
        blurForViewer={blur}
        className="h-full w-full max-w-full overflow-hidden rounded-lg"
        imgClassName={CHAT_INLINE_ASSET_IMG_CLASS}
      />
    </figure>
  );
}

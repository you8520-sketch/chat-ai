"use client";

import CharacterAssetImage from "@/components/CharacterAssetImage";
import { shouldBlurAssetForViewer, type CharacterAsset } from "@/lib/characterAssets";
import {
  CHAT_INLINE_ASSET_FIGURE_CLASS,
  CHAT_INLINE_ASSET_IMG_CLASS,
} from "@/lib/chatDisplayPrefs";
import { trpgInlineAssetFrame } from "@/lib/trpg/trpgInlineAssetFrame";

export default function InlineTaggedAssetImage({
  asset,
  viewerIsCreator = false,
  unlockedUrls,
  presentation = "chat",
}: {
  asset: CharacterAsset;
  viewerIsCreator?: boolean;
  unlockedUrls?: ReadonlySet<string>;
  /** Chat keeps the shared chat frame. TRPG passes its own size policy. */
  presentation?: "chat" | "trpg";
}) {
  const blur = shouldBlurAssetForViewer(asset, viewerIsCreator, unlockedUrls);
  const trpg = presentation === "trpg" ? trpgInlineAssetFrame(asset) : null;
  const ratio =
    asset.width && asset.height && asset.width > 0 && asset.height > 0
      ? `${asset.width} / ${asset.height}`
      : undefined;
  return (
    <figure
      data-testid="inline-tagged-asset"
      data-asset-tag={asset.tag}
      data-asset-orientation={trpg?.kind}
      className={trpg?.figureClassName ?? CHAT_INLINE_ASSET_FIGURE_CLASS}
      style={trpg ? trpg.style : ratio ? { aspectRatio: ratio } : undefined}
    >
      <CharacterAssetImage
        src={asset.url}
        alt={asset.tag}
        blurForViewer={blur}
        className={trpg?.boxClassName ?? "h-full w-full max-w-full overflow-hidden rounded-lg"}
        imgClassName={trpg?.imgClassName ?? CHAT_INLINE_ASSET_IMG_CLASS}
      />
    </figure>
  );
}

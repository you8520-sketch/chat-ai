"use client";

import CharacterAssetImage from "@/components/CharacterAssetImage";
import { shouldBlurAssetForViewer, type CharacterAsset } from "@/lib/characterAssets";
import { trpgInlineAssetFrame } from "@/lib/trpg/trpgInlineAssetFrame";

export default function TrpgCharacterSceneAsset({
  asset,
  viewerIsCreator = false,
  unlockedUrls,
}: {
  asset: CharacterAsset;
  viewerIsCreator?: boolean;
  unlockedUrls?: ReadonlySet<string>;
}) {
  if (shouldBlurAssetForViewer(asset, viewerIsCreator, unlockedUrls)) {
    return null;
  }
  const frame = trpgInlineAssetFrame(asset);
  return (
    <figure
      data-testid="trpg-character-scene-asset"
      data-asset-tag={asset.tag}
      data-asset-orientation={frame.kind}
      className={frame.figureClassName}
      style={frame.style}
    >
      <CharacterAssetImage
        src={asset.url}
        alt={asset.tag}
        blurForViewer={false}
        className={frame.boxClassName}
        imgClassName={frame.imgClassName}
      />
    </figure>
  );
}

"use client";

import CharacterAssetImage from "@/components/CharacterAssetImage";
import { isWideInlineAsset, shouldBlurAssetForViewer, type CharacterAsset } from "@/lib/characterAssets";

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
  const landscape = isWideInlineAsset(asset);
  const ratio =
    asset.width && asset.height && asset.width > 0 && asset.height > 0
      ? `${asset.width} / ${asset.height}`
      : undefined;
  return (
    <figure
      data-testid="trpg-character-scene-asset"
      data-asset-tag={asset.tag}
      data-asset-orientation={landscape ? "landscape" : "portrait"}
      className={
        landscape
          ? "my-3 w-full max-w-full"
          : "mx-auto my-3 w-full max-w-[min(16rem,72vw)] sm:max-w-[18rem]"
      }
      style={ratio ? { aspectRatio: ratio } : undefined}
    >
      <CharacterAssetImage
        src={asset.url}
        alt={asset.tag}
        blurForViewer={false}
        className="h-full w-full max-w-full overflow-hidden rounded-lg"
        imgClassName="block h-full w-full max-w-full object-contain object-center"
      />
    </figure>
  );
}

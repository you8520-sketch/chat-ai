import {
  chatAssets,
  type CharacterAsset,
} from "@/lib/characterAssets";
import { collectUnlockedAssetUrlsFromMessages } from "@/lib/characterAssetUnlock";
import type { ContentKind } from "@/lib/simulationMode";
import { assetsForMainCharacterPool } from "@/lib/visualSubjects";

export type SelectableCharacterImage = {
  url: string;
  tag: string;
};

export function resolveSelectableCharacterImages(input: {
  assets: CharacterAsset[];
  representativeUrl: string | null;
  isCharacterCreator: boolean;
  assistantMessages: string[];
  contentKind?: ContentKind;
  poolMode?: "main_character" | "all";
}): SelectableCharacterImage[] {
  const contentKind = input.contentKind ?? "character";
  const poolMode = input.poolMode ?? "main_character";
  let pool = chatAssets(input.assets);
  if (contentKind === "character" && poolMode === "main_character") {
    pool = assetsForMainCharacterPool(pool, contentKind);
  }
  const unlockedUrls = new Set(
    collectUnlockedAssetUrlsFromMessages(
      input.assistantMessages.map((content) => ({
        role: "assistant",
        content,
        generationStatus: "completed",
      })),
      pool,
      input.isCharacterCreator
    )
  );

  const selectable = pool.filter(
    (asset) =>
      input.isCharacterCreator ||
      asset.viewerBlur !== true ||
      unlockedUrls.has(asset.url)
  );
  const result: SelectableCharacterImage[] = [];
  const seen = new Set<string>();

  const add = (url: string | null | undefined, tag: string) => {
    const normalized = url?.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push({ url: normalized, tag: tag.trim() || "캐릭터 이미지" });
  };

  const representativeAsset = selectable.find(
    (asset) => asset.url === input.representativeUrl
  );
  add(input.representativeUrl, representativeAsset?.tag || "기본 이미지");
  for (const asset of selectable) add(asset.url, asset.tag);
  return result;
}

export function selectCharacterImageUrl(
  images: SelectableCharacterImage[],
  requestedUrl: unknown
): string | null {
  const requested =
    typeof requestedUrl === "string" ? requestedUrl.trim() : "";
  if (!requested) return images[0]?.url ?? null;
  return images.some((image) => image.url === requested) ? requested : null;
}

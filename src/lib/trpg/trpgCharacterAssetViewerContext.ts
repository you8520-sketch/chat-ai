import { shouldRenderTrpgCharacterSceneAsset } from "./gmSceneAssets";
import type { TrpgPublicAiCharacterAssets } from "./aiCharacterContext";
import type { CharacterAsset } from "@/lib/characterAssets";

export type TrpgCharacterAssetViewerContext = {
  viewerIsCreator: boolean;
  unlockedUrls?: ReadonlySet<string>;
};

export function resolveTrpgCharacterAssetViewerContext(
  catalog: readonly TrpgPublicAiCharacterAssets[],
  participantId: number,
  unlockedUrlsByCharacterId?: ReadonlyMap<number, ReadonlySet<string>>
): TrpgCharacterAssetViewerContext {
  const entry = catalog.find((row) => row.participantId === participantId);
  if (!entry) {
    return { viewerIsCreator: false, unlockedUrls: undefined };
  }
  return {
    viewerIsCreator: entry.viewerIsCreator,
    unlockedUrls: unlockedUrlsByCharacterId?.get(entry.characterId),
  };
}

/** Split + final component must share the same viewer visibility context. */
export function trpgCharacterSceneAssetWouldRender(
  asset: CharacterAsset,
  catalog: readonly TrpgPublicAiCharacterAssets[],
  participantId: number,
  unlockedUrlsByCharacterId?: ReadonlyMap<number, ReadonlySet<string>>
): boolean {
  const ctx = resolveTrpgCharacterAssetViewerContext(
    catalog,
    participantId,
    unlockedUrlsByCharacterId
  );
  return shouldRenderTrpgCharacterSceneAsset(asset, ctx);
}

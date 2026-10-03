/**
 * Canonical chat-tag unlock owner.
 * Only persisted assistant final messages unlock hidden assets.
 * localStorage, user text, streaming partials, and forged URLs are not authority.
 */
import { findAssetsByTag, type CharacterAsset } from "@/lib/characterAssets";
import { resolveEmotionTag, stripEmotionTag } from "@/lib/emotionTag";

export type UnlockSourceMessage = {
  role: string;
  content: string;
  generationStatus?: string | null;
};

export function isPersistedAssistantFinal(message: UnlockSourceMessage): boolean {
  if (message.role !== "assistant") return false;
  if (!message.content.trim()) return false;
  const status = (message.generationStatus ?? "completed").trim().toLowerCase();
  return status === "completed";
}

export function collectUnlockedAssetUrlsFromMessages(
  messages: readonly UnlockSourceMessage[],
  assets: CharacterAsset[],
  isCharacterCreator: boolean
): string[] {
  if (isCharacterCreator || assets.length === 0) return [];
  const allowed = assets.filter((asset) => asset.chat !== false).map((asset) => asset.tag);
  const unlocked = new Set<string>();

  for (const message of messages) {
    if (!isPersistedAssistantFinal(message)) continue;
    const { tag } = stripEmotionTag(message.content);
    if (!tag) continue;
    const resolved = resolveEmotionTag(tag, allowed);
    if (!resolved) continue;
    for (const asset of findAssetsByTag(assets, resolved)) {
      if (asset.viewerBlur === true) unlocked.add(asset.url);
    }
  }

  return Array.from(unlocked);
}

export function assetUnlockedByCompletedMessages(
  asset: CharacterAsset,
  messages: readonly UnlockSourceMessage[]
): boolean {
  if (asset.viewerBlur !== true) return false;
  const unlocked = collectUnlockedAssetUrlsFromMessages(messages, [asset], false);
  return unlocked.includes(asset.url);
}

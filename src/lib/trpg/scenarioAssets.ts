import {
  isWideInlineAsset,
  parseAssets,
  withAssetSize,
  type CharacterAsset,
} from "@/lib/characterAssets";
import { collectEmotionTags, resolveEmotionTag } from "@/lib/emotionTag";
import { attachMatchingAssetTags, consumeAssetTagsOnce } from "@/lib/inlineTaggedAssets";

export const TRPG_SCENARIO_MAX_ASSETS = 40;
export const TRPG_SCENARIO_LANDSCAPE_ONLY_ERROR =
  "대표 이미지(1번)를 제외한 시나리오 에셋은 가로로 긴 이미지만 사용할 수 있습니다.";

export function parseScenarioAssets(raw: unknown): CharacterAsset[] {
  if (typeof raw === "string") return parseAssets(raw).slice(0, TRPG_SCENARIO_MAX_ASSETS);
  if (!Array.isArray(raw)) return [];
  return parseAssets(JSON.stringify(raw)).slice(0, TRPG_SCENARIO_MAX_ASSETS);
}

export function getScenarioCoverUrl(assets: CharacterAsset[]): string | null {
  return assets[0]?.url ?? null;
}

export function playableScenarioAssets(assets: CharacterAsset[]): CharacterAsset[] {
  return assets.filter((asset) => isWideInlineAsset(asset));
}

export function assertScenarioAssetOrientations(assets: CharacterAsset[]): void {
  for (let i = 1; i < assets.length; i++) {
    const asset = assets[i];
    if (!asset) continue;
    if (!isWideInlineAsset(asset)) {
      throw new Error(TRPG_SCENARIO_LANDSCAPE_ONLY_ERROR);
    }
  }
}

export function normalizeScenarioAssets(raw: unknown): CharacterAsset[] {
  const assets = parseScenarioAssets(raw);
  assertScenarioAssetOrientations(assets);
  return assets;
}

export function rejectNonLandscapeScenarioExtra(
  asset: CharacterAsset,
  index: number
): CharacterAsset | null {
  if (index === 0) return asset;
  return isWideInlineAsset(asset) ? asset : null;
}

export function buildScenarioAssetTagPrompt(assets: CharacterAsset[]): string {
  const playable = playableScenarioAssets(assets);
  if (playable.length === 0) return "";
  const unique = [...new Set(playable.map((a) => a.tag.trim()).filter(Boolean))];
  if (unique.length === 0) return "";
  const list = unique.join(", ");
  return `[SCENARIO IMAGE TAGS — uploaded landscape scene images]
When a participating character reacts to a matching place, object, or beat, insert [태그: tagname] in the prose at that moment so the image can appear inline at full output width.
Allowed tags ONLY (copy spelling exactly): ${list}
Use each tag at most once this turn. Do not invent tags. Skip a tag if nothing in this beat matches it.`;
}

export function collectUsedScenarioTags(texts: readonly string[], assets: CharacterAsset[]): Set<string> {
  const playable = playableScenarioAssets(assets);
  const allowed = playable.map((a) => a.tag);
  const used = new Set<string>();
  for (const text of texts) {
    for (const tag of collectEmotionTags(text)) {
      const resolved = resolveEmotionTag(tag, allowed);
      if (resolved) used.add(resolved);
    }
  }
  return used;
}

export function applyScenarioAssetTagsToTurnText(
  text: string,
  assets: CharacterAsset[],
  usedTags: Set<string>,
  opts?: { attachMatches?: boolean }
): string {
  const playable = playableScenarioAssets(assets);
  if (playable.length === 0) return text;
  if (opts?.attachMatches === false) {
    return consumeAssetTagsOnce(text, playable, usedTags).text;
  }
  return attachMatchingAssetTags(text, playable, usedTags).text;
}

export function withMeasuredScenarioAsset(
  asset: CharacterAsset,
  width?: number | null,
  height?: number | null
): CharacterAsset {
  return withAssetSize(asset, width, height);
}

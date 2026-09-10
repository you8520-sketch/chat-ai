import {
  chatAssets,
  parseAssets,
  withAssetSize,
  type CharacterAsset,
} from "@/lib/characterAssets";
import { collectEmotionTags, resolveEmotionTag } from "@/lib/emotionTag";
import { attachMatchingAssetTags, consumeAssetTagsOnce } from "@/lib/inlineTaggedAssets";

export const TRPG_SCENARIO_MAX_ASSETS = 40;

export function parseScenarioAssets(raw: unknown): CharacterAsset[] {
  if (typeof raw === "string") return parseAssets(raw).slice(0, TRPG_SCENARIO_MAX_ASSETS);
  if (!Array.isArray(raw)) return [];
  return parseAssets(JSON.stringify(raw)).slice(0, TRPG_SCENARIO_MAX_ASSETS);
}

export function getScenarioCoverUrl(assets: CharacterAsset[]): string | null {
  return assets[0]?.url ?? null;
}

/**
 * Scenario images eligible for GM scene selection. Aspect ratio is NOT
 * restricted — landscape, portrait, square and unusual ratios all qualify.
 * (Display is orientation-aware at the render layer.)
 */
export function playableScenarioAssets(assets: CharacterAsset[]): CharacterAsset[] {
  return chatAssets(assets).filter(
    (asset) => asset.moderationReject !== true && asset.tag.trim()
  );
}

export function normalizeScenarioAssets(raw: unknown): CharacterAsset[] {
  return parseScenarioAssets(raw);
}

export function buildScenarioAssetTagPrompt(assets: CharacterAsset[]): string {
  const playable = playableScenarioAssets(assets);
  if (playable.length === 0) return "";
  const unique = [...new Set(playable.map((a) => a.tag.trim()).filter(Boolean))];
  if (unique.length === 0) return "";
  const list = unique.join(", ");
  return `[SCENARIO IMAGE TAGS — uploaded scene images]
GM NARRATION only. Insert [태그: tagname] only when this scene meaningfully matches that uploaded tag (environment, place, object, creature, supporting figure, event, or atmosphere).
Do not insert an image merely because the tag exists. Never add filler images to reach a quota.
Allowed scenario tags ONLY (copy spelling exactly): ${list}
Use each scenario tag at most once this turn. Do not invent tags.
Total images this scene ≤ 2. If AI characters are present, at most one scenario image. If not, at most two distinct scenario tags.
Character images use a separate [캐릭터에셋: participantId|tag] namespace when that catalog is supplied. Do not reuse [태그: ...] for character assets.`;
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

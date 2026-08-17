import {
  findAssetByTag,
  isWideInlineAsset,
  type CharacterAsset,
} from "@/lib/characterAssets";
import {
  collectEmotionTags,
  resolveEmotionTag,
  sanitizeEmotionTagInText,
  splitProseWithEmotionTags,
  stripEmotionTagsForDisplay,
} from "@/lib/emotionTag";

export type InlineAssetPart =
  | { kind: "text"; text: string }
  | { kind: "image"; tag: string; asset: CharacterAsset };

export function mergeAssetSizes(
  assets: CharacterAsset[],
  sizes: ReadonlyMap<string, { width: number; height: number }>
): CharacterAsset[] {
  if (sizes.size === 0) return assets;
  return assets.map((asset) => {
    const size = sizes.get(asset.url);
    if (!size) return asset;
    return {
      ...asset,
      width: size.width,
      height: size.height,
      orientation:
        size.width > size.height ? "landscape" : size.height > size.width ? "portrait" : "square",
    };
  });
}

/** 에셋 OFF면 태그를 모두 숨기고, ON이면 가로 태그만 본문에 남긴다. */
export function displayBodyEmotionTags(
  text: string,
  assets: CharacterAsset[],
  opts?: { streaming?: boolean; assetsEnabled?: boolean }
): string {
  if (opts?.assetsEnabled === false) {
    return stripEmotionTagsForDisplay(text, { streaming: opts.streaming });
  }
  return prepareBodyEmotionTags(text, assets, opts);
}

/** 본문에서 세로 태그는 제거하고 가로 태그만 남겨 인라인 렌더에 넘긴다. */
export function prepareBodyEmotionTags(
  text: string,
  assets: CharacterAsset[],
  opts?: { streaming?: boolean }
): string {
  const parts = splitProseWithEmotionTags(text, opts);
  if (parts.length === 0) return opts?.streaming ? text : stripEmotionTagsForDisplay(text);
  let out = "";
  for (const part of parts) {
    if (part.kind === "text") {
      out += part.text;
      continue;
    }
    const asset = findAssetByTag(assets, part.tag);
    if (asset && isWideInlineAsset(asset)) {
      out += `[태그: ${part.tag}]`;
    }
  }
  return out;
}

export function splitProseForInlineAssets(
  text: string,
  assets: CharacterAsset[],
  opts?: { streaming?: boolean; oncePerAsset?: boolean }
): InlineAssetPart[] {
  const seen = new Set<string>();
  const out: InlineAssetPart[] = [];
  for (const part of splitProseWithEmotionTags(text, opts)) {
    if (part.kind === "text") {
      if (part.text) out.push(part);
      continue;
    }
    const asset = findAssetByTag(assets, part.tag);
    if (!asset || !isWideInlineAsset(asset)) continue;
    if (opts?.oncePerAsset !== false) {
      if (seen.has(asset.url) || seen.has(asset.tag)) continue;
      seen.add(asset.url);
      seen.add(asset.tag);
    }
    out.push({ kind: "image", tag: part.tag, asset });
  }
  return out;
}

export function lastPortraitEmotionAsset(
  text: string,
  assets: CharacterAsset[]
): CharacterAsset | null {
  const allowed = assets.filter((a) => a.chat !== false).map((a) => a.tag);
  let last: CharacterAsset | null = null;
  for (const tag of collectEmotionTags(text)) {
    const resolved = resolveEmotionTag(tag, allowed);
    if (!resolved) continue;
    const asset = findAssetByTag(assets, resolved);
    if (!asset || isWideInlineAsset(asset)) continue;
    last = asset;
  }
  return last;
}

function insertTagAfterKeyword(text: string, tag: string): string {
  const idx = text.indexOf(tag);
  if (idx < 0) {
    const trimmed = text.trimEnd();
    return trimmed ? `${trimmed}\n[태그: ${tag}]` : `[태그: ${tag}]`;
  }
  const after = text.slice(idx + tag.length);
  const sentence = after.search(/[.!?。…？\n]/);
  const at = sentence >= 0 ? idx + tag.length + sentence + 1 : text.length;
  const before = text.slice(0, at).trimEnd();
  const rest = text.slice(at);
  return `${before}\n[태그: ${tag}]${rest.startsWith("\n") ? rest : `\n${rest}`}`;
}

export function consumeAssetTagsOnce(
  text: string,
  assets: CharacterAsset[],
  usedTags: Set<string>
): { text: string; used: string[] } {
  const allowed = assets.map((a) => a.tag).filter(Boolean);
  const sanitized = sanitizeEmotionTagInText(text, allowed);
  const kept: string[] = [];
  const rewritten = sanitized.replace(/\[태그:\s*([^\]]+)\]/g, (full, name: string) => {
    const tag = String(name ?? "").trim();
    const resolved = resolveEmotionTag(tag, allowed);
    if (!resolved || usedTags.has(resolved) || kept.includes(resolved)) return "";
    kept.push(resolved);
    return `[태그: ${resolved}]`;
  });
  for (const tag of kept) usedTags.add(tag);
  return { text: rewritten.replace(/\n{3,}/g, "\n\n").trimEnd(), used: kept };
}

/** 캐릭터 반응 본문에 아직 없는 시나리오 에셋을 태그명 일치 시 한 장씩 삽입 */
export function attachMatchingAssetTags(
  text: string,
  assets: CharacterAsset[],
  usedTags: Set<string>
): { text: string; used: string[] } {
  const first = consumeAssetTagsOnce(text, assets, usedTags);
  let next = first.text;
  const added = [...first.used];
  for (const asset of assets) {
    const tag = asset.tag.trim();
    if (!tag || usedTags.has(tag) || !isWideInlineAsset(asset)) continue;
    if (!next.includes(tag)) continue;
    next = insertTagAfterKeyword(next, tag);
    usedTags.add(tag);
    added.push(tag);
  }
  return { text: next, used: added };
}

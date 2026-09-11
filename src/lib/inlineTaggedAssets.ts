import {
  findAssetByTagStable,
  findAssetsByTag,
  isWideInlineAsset,
  type CharacterAsset,
} from "@/lib/characterAssets";
import {
  INLINE_ASSET_TURN_LIMIT,
  type InlineAssetOrientationPolicy,
} from "@/lib/chatAssetPresentation";
import {
  collectEmotionTags,
  resolveEmotionTag,
  sanitizeEmotionTagInText,
  splitProseWithEmotionTags,
  stripAllEmotionTagsForDisplay,
} from "@/lib/emotionTag";

export type InlineAssetPart =
  | { kind: "text"; text: string }
  | { kind: "image"; tag: string; asset: CharacterAsset };

export function assetSelectionKeyForMessage(
  m: { requestId?: string; id?: number | null },
  index: number
): string {
  if (m.requestId?.trim()) return `request:${m.requestId.trim()}`;
  if (m.id != null) return `message:${m.id}`;
  return `row:${index}`;
}

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

/** 에셋 OFF면 태그를 모두 숨기고, ON이면 표시 정책에 맞는 태그만 본문에 남긴다. */
export function displayBodyEmotionTags(
  text: string,
  assets: CharacterAsset[],
  opts?: {
    streaming?: boolean;
    assetsEnabled?: boolean;
    orientationPolicy?: InlineAssetOrientationPolicy;
    selectionKey?: string;
  }
): string {
  if (opts?.assetsEnabled === false) {
    return stripAllEmotionTagsForDisplay(text, { streaming: opts.streaming });
  }
  return prepareBodyEmotionTags(text, assets, opts);
}

/**
 * Whole-turn pure policy. Walks the entire assistant message once, resolves each
 * marker to its stable asset, and returns the body with only the approved
 * `[태그: …]` markers retained: chronological, de-duplicated by resolved asset,
 * and capped at {@link INLINE_ASSET_TURN_LIMIT} unique assets for the whole turn
 * (not per rich/novel block). No mutable global state; same input → same output.
 */
export function planInlineAssetBody(
  text: string,
  assets: CharacterAsset[],
  opts?: {
    streaming?: boolean;
    orientationPolicy?: InlineAssetOrientationPolicy;
    selectionKey?: string;
  }
): string {
  const policy = opts?.orientationPolicy ?? "landscape";
  const parts = splitProseWithEmotionTags(text, { streaming: opts?.streaming });
  const seen = new Set<string>();
  const approved: string[] = [];
  let count = 0;
  for (const part of parts) {
    if (part.kind === "text") {
      approved.push(part.text);
      continue;
    }
    if (count >= INLINE_ASSET_TURN_LIMIT) continue;
    const asset = resolveInlineAsset(assets, part.tag, policy, opts?.selectionKey);
    if (!asset) continue;
    if (policy === "landscape" && !isWideInlineAsset(asset)) continue;
    const identity = asset.url || asset.tag;
    if (seen.has(identity) || seen.has(asset.tag)) continue;
    seen.add(identity);
    seen.add(asset.tag);
    count += 1;
    approved.push(`[태그: ${part.tag}]`);
  }
  return approved.join("");
}

/** Resolve one marker to its stable inline asset for the given orientation policy. */
export function resolveInlineAsset(
  assets: CharacterAsset[],
  tag: string,
  policy: InlineAssetOrientationPolicy,
  selectionKey?: string
): CharacterAsset | null {
  const key = selectionKey?.trim();
  const displayKind = policy === "any" ? "any" : "inline";
  if (key) return findAssetByTagStable(assets, tag, key, displayKind);
  const pool = findAssetsByTag(assets, tag);
  if (policy === "landscape") return pool.find(isWideInlineAsset) ?? null;
  return pool[0] ?? null;
}

/** 본문에서 정책에 맞지 않는 태그는 제거하고 승인된 태그만 남긴다 (턴 전체 기준). */
export function prepareBodyEmotionTags(
  text: string,
  assets: CharacterAsset[],
  opts?: {
    streaming?: boolean;
    orientationPolicy?: InlineAssetOrientationPolicy;
    selectionKey?: string;
  }
): string {
  return planInlineAssetBody(text, assets, opts);
}

export function splitProseForInlineAssets(
  text: string,
  assets: CharacterAsset[],
  opts?: {
    streaming?: boolean;
    oncePerAsset?: boolean;
    assetSelectionKey?: string;
    orientationPolicy?: InlineAssetOrientationPolicy;
  }
): InlineAssetPart[] {
  const policy = opts?.orientationPolicy ?? "landscape";
  const seen = new Set<string>();
  const out: InlineAssetPart[] = [];
  for (const part of splitProseWithEmotionTags(text, opts)) {
    if (part.kind === "text") {
      if (part.text) out.push(part);
      continue;
    }
    const asset = resolveInlineAsset(assets, part.tag, policy, opts?.assetSelectionKey);
    if (!asset) continue;
    if (policy === "landscape" && !isWideInlineAsset(asset)) continue;
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
  assets: CharacterAsset[],
  selectionKey?: string
): CharacterAsset | null {
  const allowed = assets.filter((a) => a.chat !== false).map((a) => a.tag);
  const key = selectionKey?.trim();
  let last: CharacterAsset | null = null;
  for (const tag of collectEmotionTags(text)) {
    const resolved = resolveEmotionTag(tag, allowed);
    if (!resolved) continue;
    const asset = key
      ? findAssetByTagStable(assets, resolved, key, "portrait")
      : findAssetsByTag(assets, resolved).find((a) => !isWideInlineAsset(a)) ?? null;
    if (!asset) continue;
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

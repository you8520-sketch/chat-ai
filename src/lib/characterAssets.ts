export type AssetOrientation = "landscape" | "portrait" | "square";

export const MAX_REPRESENTATIVE_ASSETS = 5;

export type CharacterAsset = {
  url: string;
  tag: string;
  /** Stable visual subject identity this asset depicts. */
  visualSubjectKey?: string;
  /** 소개·카드 등에 노출 */
  public?: boolean;
  /** 대화 중 감정 태그로 전환 가능 */
  chat?: boolean;
  /** true면 제작자 외 유저에게 블러·가림 처리 */
  viewerBlur?: boolean;
  /** 애매한 선정성 — 관리자 검수 큐 (업로드 차단 아님) */
  adultFlagged?: boolean;
  /** 하드 반려: 여성 유두·남녀 성기·항문 노출 등 */
  moderationReject?: boolean;
  moderationReason?: string;
  width?: number;
  height?: number;
  orientation?: AssetOrientation;
  /** Private-media id when the original lives under getDataDir()/media. */
  mediaId?: string;
  /** Card order 1–5. Absent means not a public representative. */
  representativeRank?: number;
  /** Safe public card rendition. Never a private original path. */
  publicRenditionUrl?: string;
  /** Independent blur thumbnail. Never the original bytes. */
  blurPreviewUrl?: string;
};

export function orientationFromSize(
  width?: number | null,
  height?: number | null
): AssetOrientation | null {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  if (w > h) return "landscape";
  if (h > w) return "portrait";
  return "square";
}

export function withAssetSize(
  asset: CharacterAsset,
  width?: number | null,
  height?: number | null
): CharacterAsset {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return asset;
  const orientation = orientationFromSize(w, h);
  return {
    ...asset,
    width: Math.round(w),
    height: Math.round(h),
    ...(orientation ? { orientation } : {}),
  };
}

/** 가로로 긴 에셋만 본문 인라인. 정사각·세로는 좌측/배경 초상. 크기 미확인은 세로로 취급. */
export function isWideInlineAsset(asset: Pick<CharacterAsset, "width" | "height" | "orientation">): boolean {
  const orientation = asset.orientation ?? orientationFromSize(asset.width, asset.height);
  return orientation === "landscape";
}

export function isPortraitDisplayAsset(
  asset: Pick<CharacterAsset, "width" | "height" | "orientation">
): boolean {
  return !isWideInlineAsset(asset);
}

export const CREATOR_ASSET_TAG_MAX = 32;

/**
 * Canonical normalization for the creator-editable asset tag (custom asset
 * name). This value is BOTH the display label AND the intended semantic
 * selection cue (general-chat `[태그: …]` and TRPG `[캐릭터에셋: participantId|tag]`),
 * so the model is expected to read its meaning.
 *
 * Guarantee is STRUCTURAL only: strip control characters / line breaks /
 * brackets (which would break the `[태그: …]` marker grammar), canonicalize
 * whitespace and bound the length. It does NOT — and cannot — prevent the model
 * from interpreting the label text; that is the feature. Prompt candidate
 * collections are separately boundary-safe via `serializePromptLabels`. Read
 * and write paths share this owner.
 */
export function normalizeCreatorAssetTag(raw: unknown, fallback = ""): string {
  const cleaned = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f\r\n\t]/g, " ")
    .replace(/[\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CREATOR_ASSET_TAG_MAX);
  return cleaned || fallback;
}

function optionalSizeFields(raw: Partial<CharacterAsset>): Pick<CharacterAsset, "width" | "height" | "orientation"> {
  const width = Number(raw.width);
  const height = Number(raw.height);
  const stored =
    raw.orientation === "landscape" || raw.orientation === "portrait" || raw.orientation === "square"
      ? raw.orientation
      : null;
  const orientation = stored ?? orientationFromSize(width, height);
  return {
    ...(Number.isFinite(width) && width > 0 ? { width: Math.round(width) } : {}),
    ...(Number.isFinite(height) && height > 0 ? { height: Math.round(height) } : {}),
    ...(orientation ? { orientation } : {}),
  };
}

export { ASSET_PERSON_TAGS as EMOTION_TAGS } from "@/lib/assetPersonTags";
export type { AssetPersonTag } from "@/lib/assetPersonTags";

export function isStoredAssetUrl(url: string): boolean {
  return (
    url.startsWith("/uploads/") ||
    url.startsWith("/media/private/") ||
    url.startsWith("/media/public/") ||
    url.startsWith("http://") ||
    url.startsWith("https://")
  );
}

export function isPrivateMediaUrl(url: string): boolean {
  return url.startsWith("/media/private/");
}

function optionalMediaFields(
  raw: Partial<CharacterAsset>
): Pick<CharacterAsset, "mediaId" | "publicRenditionUrl" | "blurPreviewUrl"> {
  const mediaId = typeof raw.mediaId === "string" ? raw.mediaId.trim() : "";
  const publicRenditionUrl =
    typeof raw.publicRenditionUrl === "string" ? raw.publicRenditionUrl.trim() : "";
  const blurPreviewUrl = typeof raw.blurPreviewUrl === "string" ? raw.blurPreviewUrl.trim() : "";
  return {
    ...(mediaId ? { mediaId } : {}),
    ...(publicRenditionUrl && !isPrivateMediaUrl(publicRenditionUrl)
      ? { publicRenditionUrl }
      : {}),
    ...(blurPreviewUrl && !isPrivateMediaUrl(blurPreviewUrl) ? { blurPreviewUrl } : {}),
  };
}

function parseRepresentativeRank(raw: unknown): number | undefined {
  const rank = Number(raw);
  if (!Number.isInteger(rank) || rank < 1 || rank > MAX_REPRESENTATIVE_ASSETS) return undefined;
  return rank;
}

function hasExplicitRepresentativeRanks(list: readonly Partial<CharacterAsset>[]): boolean {
  return list.some((asset) => parseRepresentativeRank(asset.representativeRank) != null);
}

function compactRepresentativeRanks(assets: CharacterAsset[]): CharacterAsset[] {
  const ranked = assets
    .map((asset, index) => ({ asset, index, rank: parseRepresentativeRank(asset.representativeRank) }))
    .filter((row): row is { asset: CharacterAsset; index: number; rank: number } => row.rank != null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, MAX_REPRESENTATIVE_ASSETS);
  const rankByIndex = new Map(ranked.map((row, order) => [row.index, order + 1]));
  return assets.map((asset, index) => {
    const rank = rankByIndex.get(index);
    if (rank != null) {
      return { ...asset, representativeRank: rank, viewerBlur: false };
    }
    if (asset.representativeRank == null) return asset;
    const { representativeRank: _dropped, ...rest } = asset;
    return rest;
  });
}

function normalizeAsset(
  raw: Partial<CharacterAsset>,
  index: number,
  legacyForceFirstPublic: boolean
): CharacterAsset {
  const storedBlur =
    typeof raw.viewerBlur === "boolean" ? raw.viewerBlur : index === 0 && legacyForceFirstPublic ? false : true;
  const representativeRank = parseRepresentativeRank(raw.representativeRank);
  return {
    url: String(raw.url),
    tag: normalizeCreatorAssetTag(raw.tag),
    ...(typeof raw.visualSubjectKey === "string" && raw.visualSubjectKey.trim()
      ? { visualSubjectKey: raw.visualSubjectKey.trim() }
      : {}),
    // 업로드한 에셋은 모두 소개·대화 풀에 포함. UI에서 고르는 것은 가림(viewerBlur)뿐.
    public: true,
    chat: true,
    viewerBlur: representativeRank != null ? false : legacyForceFirstPublic && index === 0 ? false : storedBlur,
    ...(typeof raw.adultFlagged === "boolean" ? { adultFlagged: raw.adultFlagged } : {}),
    ...(typeof raw.moderationReject === "boolean" ? { moderationReject: raw.moderationReject } : {}),
    ...(typeof raw.moderationReason === "string" && raw.moderationReason.trim()
      ? { moderationReason: raw.moderationReason.trim().slice(0, 200) }
      : {}),
    ...optionalSizeFields(raw),
    ...optionalMediaFields(raw),
    ...(representativeRank != null ? { representativeRank } : {}),
  };
}

/** Creator/editor asset list normalization — single owner for metadata preservation. */
export function normalizeCharacterAssets(
  list: readonly Partial<CharacterAsset>[]
): CharacterAsset[] {
  const filtered = list.filter(
    (asset) => asset && typeof asset.url === "string" && typeof asset.tag === "string"
  );
  const legacyForceFirstPublic = !hasExplicitRepresentativeRanks(filtered);
  return compactRepresentativeRanks(
    filtered.map((asset, index) => normalizeAsset(asset, index, legacyForceFirstPublic))
  );
}

/** Representatives are always unblurred. Legacy lists still force index 0 public. */
export function withRepresentativeAssetPublic(assets: CharacterAsset[]): CharacterAsset[] {
  if (assets.length === 0) return assets;
  if (hasExplicitRepresentativeRanks(assets)) {
    return assets.map((asset) =>
      asset.representativeRank != null && asset.viewerBlur === true
        ? { ...asset, viewerBlur: false }
        : asset
    );
  }
  if (assets[0].viewerBlur !== true) return assets;
  return assets.map((a, i) => (i === 0 ? { ...a, viewerBlur: false } : a));
}

export function reorderCharacterAssets(
  assets: CharacterAsset[],
  from: number,
  to: number
): CharacterAsset[] {
  if (from === to || from < 0 || to < 0 || from >= assets.length || to >= assets.length) {
    return assets;
  }
  const next = [...assets];
  const [item] = next.splice(from, 1);
  if (!item) return assets;
  next.splice(to, 0, item);
  return withRepresentativeAssetPublic(next);
}

export function updateCharacterAssetTag(
  assets: CharacterAsset[],
  index: number,
  tag: string
): CharacterAsset[] {
  return assets.map((asset, assetIndex) =>
    assetIndex === index ? { ...asset, tag } : asset
  );
}

export function toggleCharacterAssetViewerBlur(
  assets: CharacterAsset[],
  index: number
): CharacterAsset[] {
  if (index < 0 || index >= assets.length) return assets;
  const target = assets[index];
  if (!target) return assets;
  if (target.representativeRank != null) return assets;
  if (!hasExplicitRepresentativeRanks(assets) && index === 0) return assets;
  return withRepresentativeAssetPublic(
    assets.map((asset, assetIndex) =>
      assetIndex === index ? { ...asset, viewerBlur: !asset.viewerBlur } : asset
    )
  );
}

export function getRepresentativeAssets(assets: readonly CharacterAsset[]): CharacterAsset[] {
  const ranked = assets
    .filter((asset) => parseRepresentativeRank(asset.representativeRank) != null)
    .sort(
      (a, b) =>
        (a.representativeRank ?? 0) - (b.representativeRank ?? 0) ||
        assets.indexOf(a) - assets.indexOf(b)
    );
  if (ranked.length > 0) return ranked.slice(0, MAX_REPRESENTATIVE_ASSETS);
  return assets[0] ? [assets[0]] : [];
}

export function isRepresentativeAsset(asset: Pick<CharacterAsset, "representativeRank">): boolean {
  return parseRepresentativeRank(asset.representativeRank) != null;
}

/** Public card/list URL — never a private original. */
export function publicRepresentativeUrl(asset: CharacterAsset): string | null {
  if (asset.publicRenditionUrl && !isPrivateMediaUrl(asset.publicRenditionUrl)) {
    return asset.publicRenditionUrl;
  }
  if (isPrivateMediaUrl(asset.url)) return null;
  if (isStoredAssetUrl(asset.url)) return asset.url;
  return null;
}

export function safeLockedPreviewUrl(asset: CharacterAsset): string | null {
  if (asset.blurPreviewUrl && !isPrivateMediaUrl(asset.blurPreviewUrl)) {
    return asset.blurPreviewUrl;
  }
  if (asset.url.startsWith("/uploads/")) {
    const name = asset.url.slice("/uploads/".length);
    const stem = name.replace(/\.[a-zA-Z0-9]+$/, "");
    if (stem && !stem.includes("/") && !stem.includes("..")) {
      return `/media/public/legacy-blur-${stem}.webp`;
    }
  }
  return null;
}

export function listingImageUrls(assets: readonly CharacterAsset[]): string[] {
  return getRepresentativeAssets(assets)
    .map((asset) => publicRepresentativeUrl(asset))
    .filter((url): url is string => Boolean(url));
}

export function assignRepresentativeRanks(
  assets: CharacterAsset[],
  orderedIndexes: readonly number[]
): CharacterAsset[] {
  const unique = [...new Set(orderedIndexes)].filter(
    (index) => Number.isInteger(index) && index >= 0 && index < assets.length
  );
  const next = assets.map((asset, index) => {
    const rank = unique.indexOf(index);
    if (rank === -1) {
      if (asset.representativeRank == null) return asset;
      const { representativeRank: _dropped, ...rest } = asset;
      return rest;
    }
    return { ...asset, representativeRank: rank + 1, viewerBlur: false };
  });
  return normalizeCharacterAssets(next);
}

export function toggleRepresentativeAsset(
  assets: CharacterAsset[],
  index: number
): CharacterAsset[] {
  if (index < 0 || index >= assets.length) return assets;
  const current = getRepresentativeAssets(
    hasExplicitRepresentativeRanks(assets) ? assets : []
  );
  const currentIndexes = current
    .map((asset) => assets.findIndex((row) => row.url === asset.url && row.tag === asset.tag))
    .filter((rowIndex) => rowIndex >= 0);
  const existing = currentIndexes.indexOf(index);
  if (existing >= 0) {
    currentIndexes.splice(existing, 1);
    return assignRepresentativeRanks(assets, currentIndexes);
  }
  if (currentIndexes.length >= MAX_REPRESENTATIVE_ASSETS) return assets;
  return assignRepresentativeRanks(assets, [...currentIndexes, index]);
}

export function reorderRepresentativeAssets(
  assets: CharacterAsset[],
  fromRank: number,
  toRank: number
): CharacterAsset[] {
  const current = getRepresentativeAssets(
    hasExplicitRepresentativeRanks(assets) ? assets : assets[0] ? [{ ...assets[0], representativeRank: 1 }] : []
  );
  const indexes = current
    .map((asset) => assets.findIndex((row) => row === asset || (row.url === asset.url && row.tag === asset.tag)))
    .filter((index) => index >= 0);
  const from = fromRank - 1;
  const to = toRank - 1;
  if (from < 0 || to < 0 || from >= indexes.length || to >= indexes.length) return assets;
  const next = [...indexes];
  const [moved] = next.splice(from, 1);
  if (moved == null) return assets;
  next.splice(to, 0, moved);
  return assignRepresentativeRanks(assets, next);
}

export function parseAssets(raw: string | null | undefined): CharacterAsset[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeCharacterAssets(parsed);
  } catch {
    return [];
  }
}

export function publicAssets(assets: CharacterAsset[]): CharacterAsset[] {
  return assets.filter((a) => a.public !== false);
}

export function chatAssets(assets: CharacterAsset[]): CharacterAsset[] {
  return assets.filter((a) => a.chat !== false);
}

export function assetUrls(assets: CharacterAsset[]): string[] {
  return assets.map((a) => a.url);
}

export function publicAssetUrls(assets: CharacterAsset[]): string[] {
  return publicAssets(assets).map((a) => a.url);
}

function parseLegacyImageUrls(imagesRaw?: string | null | undefined): string[] {
  if (!imagesRaw) return [];
  try {
    const parsed = JSON.parse(imagesRaw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * Card/list representative URLs — ranked 1–5 public renditions.
 * Legacy rows without ranks expose only images[0]/assets[0] so hidden
 * gallery files are not cycled on public cards.
 */
export function getCharacterRepresentativePublicUrls(
  assetsRaw: string | null | undefined,
  imagesRaw?: string | null | undefined
): string[] {
  const assets = parseAssets(assetsRaw);
  const fromAssets = listingImageUrls(assets);
  if (fromAssets.length > 0) return fromAssets;
  const legacy = parseLegacyImageUrls(imagesRaw);
  const first = legacy.find((url) => !isPrivateMediaUrl(url));
  return first ? [first] : [];
}

/** 카드·목록용 대표 이미지 — 1순위 공개 rendition, 없으면 legacy images[0] */
export function getCharacterRepresentativeImageUrl(
  assetsRaw: string | null | undefined,
  imagesRaw?: string | null | undefined
): string | null {
  return getCharacterRepresentativePublicUrls(assetsRaw, imagesRaw)[0] ?? null;
}

function pickRandomAsset<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

export type AssetDisplayKind = "portrait" | "inline" | "any";

/** FNV-1a — chat render path only; no Math.random(). */
export function stableAssetIndex(key: string, poolLength: number): number {
  if (poolLength <= 0) return 0;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % poolLength;
}

function assetPoolForDisplayKind(
  assets: CharacterAsset[],
  tag: string,
  displayKind: AssetDisplayKind
): CharacterAsset[] {
  const pool = findAssetsByTag(assets, tag);
  if (displayKind === "portrait") return pool.filter((a) => !isWideInlineAsset(a));
  if (displayKind === "inline") return pool.filter(isWideInlineAsset);
  return pool;
}

/**
 * Chat render 전용 — 동일 selectionKey+tag+displayKind면 항상 같은 asset.
 * Math.random() 사용하지 않음.
 */
export function findAssetByTagStable(
  assets: CharacterAsset[],
  tag: string,
  selectionKey: string,
  displayKind: AssetDisplayKind = "any"
): CharacterAsset | null {
  const q = tag.trim();
  const key = selectionKey.trim();
  if (!q || !key) return null;
  const pool = assetPoolForDisplayKind(assets, q, displayKind);
  if (pool.length === 0) return null;
  const idx = stableAssetIndex(`${key}|${q}|${displayKind}`, pool.length);
  return pool[idx] ?? null;
}

/** 태그명으로 chat 에셋 찾기 — 동일 태그가 여러 장이면 그중 무작위 1장 */
export function findAssetByTag(assets: CharacterAsset[], tag: string): CharacterAsset | null {
  const q = tag.trim();
  const exactMatches = findAssetsByTag(assets, q);
  return pickRandomAsset(exactMatches);
}

export function findAssetsByTag(assets: CharacterAsset[], tag: string): CharacterAsset[] {
  const pool = chatAssets(assets);
  const q = tag.trim();
  if (!pool.length || !q) return [];
  return pool.filter((a) => a.tag === q);
}

/** 태그명으로 에셋 URL 찾기 (부분 일치 포함, chat 활성 에셋만) */
export function findAssetUrl(assets: CharacterAsset[], tag: string): string | null {
  return findAssetByTag(assets, tag)?.url ?? null;
}

/** 대화 기본(입장) 에셋 — 세로 초상만. chat 풀의 첫 번째, 가림 없는 것 우선 */
export function getDefaultChatAsset(assets: CharacterAsset[]): CharacterAsset | null {
  const pool = chatAssets(assets).filter((a) => isPortraitDisplayAsset(a));
  if (pool.length > 0) {
    return pool.find((a) => a.viewerBlur !== true) ?? pool[0] ?? null;
  }
  return null;
}

export function portraitChatAssets(assets: CharacterAsset[]): CharacterAsset[] {
  return chatAssets(assets).filter((a) => isPortraitDisplayAsset(a));
}

/** 새 에셋 추가 시 기본 플래그 — 전부 소개·대화 포함, 첫 장만 대표 1 */
export function defaultAssetFlags(existing: CharacterAsset[], batchIndex: number) {
  const isVeryFirstAsset = existing.length === 0 && batchIndex === 0;
  return {
    public: true,
    chat: true,
    viewerBlur: !isVeryFirstAsset,
    ...(isVeryFirstAsset ? { representativeRank: 1 as const } : {}),
  };
}

export function assetByUrl(
  assets: CharacterAsset[],
  url: string | null | undefined
): CharacterAsset | undefined {
  if (!url) return undefined;
  return assets.find((a) => a.url === url);
}

export function shouldBlurAssetForViewer(
  asset: CharacterAsset | undefined,
  viewerIsCreator: boolean,
  unlockedUrls?: ReadonlySet<string>
): boolean {
  if (viewerIsCreator || !asset) return false;
  if (unlockedUrls?.has(asset.url)) return false;
  return asset.viewerBlur === true;
}

export type AssetOrientation = "landscape" | "portrait" | "square";

export type CharacterAsset = {
  url: string;
  tag: string;
  /** Simulation-only: stable visual subject this asset depicts. */
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

export const EMOTION_TAGS = [
  "기쁨",
  "슬픔",
  "분노",
  "당황",
  "부끄러움",
  "대화",
  "전투",
  "침실",
  "놀람",
  "무표정",
  "슬픔",
  "사랑",
  "공포",
] as const;

function normalizeAsset(raw: Partial<CharacterAsset>, index: number): CharacterAsset {
  const storedBlur =
    typeof raw.viewerBlur === "boolean" ? raw.viewerBlur : index === 0 ? false : true;
  return {
    url: String(raw.url),
    tag: String(raw.tag),
    ...(typeof raw.visualSubjectKey === "string" && raw.visualSubjectKey.trim()
      ? { visualSubjectKey: raw.visualSubjectKey.trim() }
      : {}),
    // 업로드한 에셋은 모두 소개·대화 풀에 포함. UI에서 고르는 것은 가림(viewerBlur)뿐.
    public: true,
    chat: true,
    // 1번(대표) 에셋은 항상 공개 — 저장값이 true여도 강제 해제
    viewerBlur: index === 0 ? false : storedBlur,
    ...(typeof raw.adultFlagged === "boolean" ? { adultFlagged: raw.adultFlagged } : {}),
    ...(typeof raw.moderationReject === "boolean" ? { moderationReject: raw.moderationReject } : {}),
    ...(typeof raw.moderationReason === "string" && raw.moderationReason.trim()
      ? { moderationReason: raw.moderationReason.trim().slice(0, 200) }
      : {}),
    ...optionalSizeFields(raw),
  };
}

/** 대표(인덱스 0)는 항상 비가림. 순서 변경·저장 직후 호출 */
export function withRepresentativeAssetPublic(assets: CharacterAsset[]): CharacterAsset[] {
  if (assets.length === 0) return assets;
  if (assets[0].viewerBlur !== true) return assets;
  return assets.map((a, i) => (i === 0 ? { ...a, viewerBlur: false } : a));
}

export function parseAssets(raw: string | null | undefined): CharacterAsset[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((a) => a && typeof a.url === "string" && typeof a.tag === "string")
      .map((a, i) => normalizeAsset(a, i));
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

/** 카드·목록용 대표 이미지 — 에셋 순서 1번(인덱스 0) 고정, 없으면 legacy images[0] */
export function getCharacterRepresentativeImageUrl(
  assetsRaw: string | null | undefined,
  imagesRaw?: string | null | undefined
): string | null {
  const assets = parseAssets(assetsRaw);
  if (assets[0]?.url) return assets[0].url;
  if (!imagesRaw) return null;
  try {
    const parsed = JSON.parse(imagesRaw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const first = parsed.find((v) => typeof v === "string" && v.trim());
    return typeof first === "string" ? first : null;
  } catch {
    return null;
  }
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

/** 새 에셋 추가 시 기본 플래그 — 전부 소개·대화 포함, 첫 장만 비가림 */
export function defaultAssetFlags(existing: CharacterAsset[], batchIndex: number) {
  const isVeryFirstAsset = existing.length === 0 && batchIndex === 0;
  return {
    public: true,
    chat: true,
    viewerBlur: !isVeryFirstAsset,
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

export type CharacterAsset = {
  url: string;
  tag: string;
  /** 소개·카드 등에 노출 */
  public?: boolean;
  /** 대화 중 감정 태그로 전환 가능 */
  chat?: boolean;
  /** true면 제작자 외 유저에게 블러·가림 처리 */
  viewerBlur?: boolean;
};

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
  return {
    url: String(raw.url),
    tag: String(raw.tag),
    // 업로드한 에셋은 모두 소개·대화 풀에 포함. UI에서 고르는 것은 가림(viewerBlur)뿐.
    public: true,
    chat: true,
    viewerBlur:
      typeof raw.viewerBlur === "boolean" ? raw.viewerBlur : index === 0 ? false : true,
  };
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

/** 대화 기본(입장) 에셋 — chat 풀의 첫 번째, 가림 없는 것 우선 */
export function getDefaultChatAsset(assets: CharacterAsset[]): CharacterAsset | null {
  const pool = chatAssets(assets);
  if (pool.length > 0) {
    return pool.find((a) => a.viewerBlur !== true) ?? pool[0];
  }
  return assets[0] ?? null;
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

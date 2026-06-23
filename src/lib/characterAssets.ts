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
    public: typeof raw.public === "boolean" ? raw.public : index === 0,
    chat: typeof raw.chat === "boolean" ? raw.chat : true,
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
  return assets.filter((a) => a.public);
}

export function chatAssets(assets: CharacterAsset[]): CharacterAsset[] {
  return assets.filter((a) => a.chat);
}

export function assetUrls(assets: CharacterAsset[]): string[] {
  return assets.map((a) => a.url);
}

export function publicAssetUrls(assets: CharacterAsset[]): string[] {
  return publicAssets(assets).map((a) => a.url);
}

/** 카드·목록용 대표 이미지 — public assets 우선, 없으면 legacy images[0] */
export function getCharacterRepresentativeImageUrl(
  assetsRaw: string | null | undefined,
  imagesRaw?: string | null | undefined
): string | null {
  const fromAssets = publicAssetUrls(parseAssets(assetsRaw));
  if (fromAssets[0]) return fromAssets[0];
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

/** 태그명으로 chat 에셋 찾기 */
export function findAssetByTag(assets: CharacterAsset[], tag: string): CharacterAsset | null {
  const pool = chatAssets(assets);
  if (!pool.length || !tag.trim()) return null;
  const q = tag.trim();
  const exact = pool.find((a) => a.tag === q);
  if (exact) return exact;
  const partial = pool.find((a) => a.tag.includes(q) || q.includes(a.tag));
  return partial ?? null;
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

/** 새 에셋 추가 시 기본 노출·대화·가림 플래그 (첫 번째 이미지만 노출·비가림) */
export function defaultAssetFlags(existing: CharacterAsset[], batchIndex: number) {
  const hasPublic = existing.some((a) => a.public !== false);
  const isVeryFirstAsset = existing.length === 0 && batchIndex === 0;
  return {
    public: !hasPublic && batchIndex === 0,
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

const STORAGE_KEY_PREFIX = "playai-character-asset-unlocks:";
const ALBUM_CATALOG_KEY = "playai-character-asset-albums";
const STORAGE_VERSION = 1;

type StoredAssetUnlocks = {
  version?: number;
  urls?: unknown;
};

export type StoredCharacterAssetAlbum = {
  characterId: number;
  characterName: string;
  assets: Array<{ url: string; tag: string }>;
  updatedAt: string;
};

function storageKey(characterId: number): string {
  return `${STORAGE_KEY_PREFIX}${characterId}`;
}

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeUrlList(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.filter((url): url is string => typeof url === "string" && url.length > 0);
}

export function loadUnlockedCharacterAssetUrls(characterId: number): Set<string> {
  if (!canUseLocalStorage()) return new Set();

  try {
    const raw = window.localStorage.getItem(storageKey(characterId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as StoredAssetUnlocks;
    return new Set(normalizeUrlList(parsed.urls));
  } catch {
    return new Set();
  }
}

export function saveUnlockedCharacterAssetUrls(
  characterId: number,
  urls: Iterable<string>
): void {
  if (!canUseLocalStorage()) return;

  const normalized = Array.from(new Set(urls)).filter(Boolean);
  try {
    window.localStorage.setItem(
      storageKey(characterId),
      JSON.stringify({ version: STORAGE_VERSION, urls: normalized })
    );
  } catch {
    // localStorage may be unavailable (quota/private mode). In-memory unlock state still works.
  }
}

export function listCharacterAssetAlbums(): StoredCharacterAssetAlbum[] {
  if (!canUseLocalStorage()) return [];

  try {
    const raw = window.localStorage.getItem(ALBUM_CATALOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { albums?: unknown };
    if (!Array.isArray(parsed.albums)) return [];
    return parsed.albums
      .map((album): StoredCharacterAssetAlbum | null => {
        if (!album || typeof album !== "object") return null;
        const a = album as {
          characterId?: unknown;
          characterName?: unknown;
          assets?: unknown;
          updatedAt?: unknown;
        };
        const characterId = Number(a.characterId);
        if (!Number.isFinite(characterId) || characterId <= 0) return null;
        const assets = Array.isArray(a.assets)
          ? a.assets
              .map((asset): { url: string; tag: string } | null => {
                if (!asset || typeof asset !== "object") return null;
                const item = asset as { url?: unknown; tag?: unknown };
                if (typeof item.url !== "string" || !item.url) return null;
                return {
                  url: item.url,
                  tag: typeof item.tag === "string" ? item.tag : "",
                };
              })
              .filter((asset): asset is { url: string; tag: string } => asset != null)
          : [];
        return {
          characterId,
          characterName:
            typeof a.characterName === "string" && a.characterName.trim()
              ? a.characterName.trim()
              : `#${characterId}`,
          assets,
          updatedAt: typeof a.updatedAt === "string" ? a.updatedAt : "",
        };
      })
      .filter((album): album is StoredCharacterAssetAlbum => album != null && album.assets.length > 0)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export function saveCharacterAssetAlbum(
  characterId: number,
  characterName: string,
  assets: Array<{ url: string; tag: string }>
): void {
  if (!canUseLocalStorage()) return;

  const normalizedAssets = assets
    .filter((asset) => asset.url)
    .map((asset) => ({ url: asset.url, tag: asset.tag || "" }));
  if (normalizedAssets.length === 0) return;

  try {
    const albums = listCharacterAssetAlbums().filter((album) => album.characterId !== characterId);
    albums.unshift({
      characterId,
      characterName: characterName.trim() || `#${characterId}`,
      assets: normalizedAssets,
      updatedAt: new Date().toISOString(),
    });
    window.localStorage.setItem(
      ALBUM_CATALOG_KEY,
      JSON.stringify({ version: STORAGE_VERSION, albums: albums.slice(0, 80) })
    );
  } catch {
    // localStorage may be unavailable. The active chat album still works in memory.
  }
}

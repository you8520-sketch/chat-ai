const STORAGE_KEY_PREFIX = "playai-character-asset-unlocks:";
const ALBUM_CATALOG_KEY = "playai-character-asset-albums";
const STORAGE_VERSION = 1;

export const CHARACTER_ASSET_ALBUM_UPDATED_EVENT =
  "playai-character-asset-album-updated";

type StoredAssetUnlocks = {
  version?: number;
  urls?: unknown;
};

export type StoredCharacterAlbumAsset = {
  url: string;
  tag: string;
};

export type StoredCharacterAssetAlbum = {
  characterId: number;
  characterName: string;
  assets: StoredCharacterAlbumAsset[];
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

function normalizeAlbumAsset(raw: unknown): StoredCharacterAlbumAsset | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as { url?: unknown; tag?: unknown };
  const url = typeof item.url === "string" ? item.url.trim() : "";
  if (!url) return null;
  return {
    url,
    tag: typeof item.tag === "string" ? item.tag.trim() : "",
  };
}

export function mergeCharacterAlbumAssets(
  preferred: StoredCharacterAlbumAsset[],
  preserved: StoredCharacterAlbumAsset[]
): StoredCharacterAlbumAsset[] {
  const seen = new Set<string>();
  const merged: StoredCharacterAlbumAsset[] = [];
  for (const raw of [...preferred, ...preserved]) {
    const asset = normalizeAlbumAsset(raw);
    if (!asset || seen.has(asset.url)) continue;
    seen.add(asset.url);
    merged.push(asset);
  }
  return merged.slice(0, 240);
}

function dispatchAlbumUpdated(characterId: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(CHARACTER_ASSET_ALBUM_UPDATED_EVENT, {
      detail: { characterId },
    })
  );
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
              .map(normalizeAlbumAsset)
              .filter((asset): asset is StoredCharacterAlbumAsset => asset != null)
          : [];
        return {
          characterId,
          characterName:
            typeof a.characterName === "string" && a.characterName.trim()
              ? a.characterName.trim()
              : `#${characterId}`,
          assets: mergeCharacterAlbumAssets(assets, []),
          updatedAt: typeof a.updatedAt === "string" ? a.updatedAt : "",
        };
      })
      .filter((album): album is StoredCharacterAssetAlbum => album != null && album.assets.length > 0)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

function writeCharacterAssetAlbum(
  characterId: number,
  characterName: string,
  assets: StoredCharacterAlbumAsset[]
): void {
  if (!canUseLocalStorage() || assets.length === 0) return;

  try {
    const albums = listCharacterAssetAlbums().filter((album) => album.characterId !== characterId);
    albums.unshift({
      characterId,
      characterName: characterName.trim() || `#${characterId}`,
      assets,
      updatedAt: new Date().toISOString(),
    });
    window.localStorage.setItem(
      ALBUM_CATALOG_KEY,
      JSON.stringify({ version: STORAGE_VERSION, albums: albums.slice(0, 80) })
    );
    dispatchAlbumUpdated(characterId);
  } catch {
    // localStorage may be unavailable. The active chat album still works in memory.
  }
}

/**
 * Saves the canonical/unlocked album while preserving user-generated images that
 * were already added for the same character.
 */
export function saveCharacterAssetAlbum(
  characterId: number,
  characterName: string,
  assets: StoredCharacterAlbumAsset[]
): void {
  if (!canUseLocalStorage()) return;
  const existing = listCharacterAssetAlbums().find(
    (album) => album.characterId === characterId
  );
  const merged = mergeCharacterAlbumAssets(assets, existing?.assets ?? []);
  writeCharacterAssetAlbum(characterId, characterName, merged);
}

/** Adds one generated SD/comic image without replacing the existing album. */
export function appendCharacterAssetAlbumAsset(
  characterId: number,
  characterName: string,
  asset: StoredCharacterAlbumAsset
): void {
  if (!canUseLocalStorage()) return;
  const normalized = normalizeAlbumAsset(asset);
  if (!normalized) return;
  const existing = listCharacterAssetAlbums().find(
    (album) => album.characterId === characterId
  );
  const merged = mergeCharacterAlbumAssets([normalized], existing?.assets ?? []);
  writeCharacterAssetAlbum(characterId, characterName, merged);
}

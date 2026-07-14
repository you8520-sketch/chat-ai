const STORAGE_KEY_PREFIX = "playai-character-asset-unlocks:";
const STORAGE_VERSION = 1;

type StoredAssetUnlocks = {
  version?: number;
  urls?: unknown;
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

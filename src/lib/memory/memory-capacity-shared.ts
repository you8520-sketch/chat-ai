export const MEMORY_CAPACITY_FIXED = 10000;
/** archive_summary — rolling-summary overflow / compressed past lore (separate from lorebook UI) */
export const ARCHIVE_CAPACITY_FIXED = 3000;
export const MEMORY_CAPACITY_DEFAULT = MEMORY_CAPACITY_FIXED;

export function normalizeMemoryCapacity(_value?: unknown): number {
  return MEMORY_CAPACITY_FIXED;
}

export type MemoryBudgetFromCapacity = {
  lorebook: number;
  recent: number;
  pinned: number;
  archive: number;
  total: number;
};

export function resolveMemoryBudgetFromCapacity(_capacity?: number): MemoryBudgetFromCapacity {
  const lorebook = MEMORY_CAPACITY_FIXED;
  const archive = ARCHIVE_CAPACITY_FIXED;
  return {
    lorebook,
    recent: lorebook,
    pinned: 0,
    archive,
    total: lorebook + archive,
  };
}

/**
 * Shared world lorebook vs character-local lorebook attach.
 *
 * - World bible lorebook is the COMMON owner for every character in the world.
 * - Character-local entries are extra attach candidates for that character only.
 * - The same entryKey is never created twice: the shared owner wins.
 */
import type { OfficialWorldLorebookEntry } from "@/lib/officialSupply/types";

export const LUCIAN_APPROVED_LOREBOOK_KEYS = [
  "mercator_internal_dealings",
  "aether_bonds",
  "mercator_exchange_underworld",
  "bio_aether_taboos",
] as const;

export function resolveOfficialCharacterLorebooks(
  shared: readonly OfficialWorldLorebookEntry[],
  characterLocal: readonly OfficialWorldLorebookEntry[] = []
): OfficialWorldLorebookEntry[] {
  const seen = new Set(shared.map((entry) => entry.entryKey));
  return [...shared, ...characterLocal.filter((entry) => !seen.has(entry.entryKey))];
}

/**
 * Canonical official semantic draft identity.
 *
 * Storage / operation keys (published predecessor rows, upload filenames,
 * replacement draft_key) stay as stored. Shot-storyboard seed hashes this
 * semantic identity so a predecessor alias does not rotate a different board.
 */

export const LUCIAN_DRAFT_KEY = "pilot-rf-03";
/** Published predecessor still mapped to live Lucian. Compile/write never uses this key. */
export const LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY = "pilot-rf-v4-03";

/**
 * Explicit predecessor → canonical compile key. Not a version-string stripper.
 * Unknown keys stay themselves.
 */
const OFFICIAL_SEMANTIC_DRAFT_KEY_ALIASES = {
  [LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY]: LUCIAN_DRAFT_KEY,
} as const;

export function resolveCanonicalOfficialDraftKey(draftKey: string): string {
  if (draftKey === LUCIAN_DRAFT_KEY) return LUCIAN_DRAFT_KEY;
  if (draftKey === LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY) {
    return OFFICIAL_SEMANTIC_DRAFT_KEY_ALIASES[LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY];
  }
  return draftKey;
}

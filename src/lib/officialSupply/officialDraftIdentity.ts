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

export const WOLFGANG_DRAFT_KEY = "pilot-rf-02";
/** Published predecessor still mapped to live Wolfgang (#51). Compile/write never uses this key. */
export const WOLFGANG_PUBLISHED_PREDECESSOR_DRAFT_KEY = "pilot-rf-v4-02";

/**
 * Explicit predecessor → canonical compile key. Not a version-string stripper.
 * Unknown keys stay themselves.
 */
const OFFICIAL_SEMANTIC_DRAFT_KEY_ALIASES: ReadonlyMap<string, string> = new Map([
  [LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY, LUCIAN_DRAFT_KEY],
  [WOLFGANG_PUBLISHED_PREDECESSOR_DRAFT_KEY, WOLFGANG_DRAFT_KEY],
]);

export function resolveCanonicalOfficialDraftKey(draftKey: string): string {
  return OFFICIAL_SEMANTIC_DRAFT_KEY_ALIASES.get(draftKey) ?? draftKey;
}

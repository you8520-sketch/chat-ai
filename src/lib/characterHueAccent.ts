/**
 * Decorative character hue for the home editorial card.
 * `characters.hue` is the existing visual color (card/portrait fallback), not a
 * semantic state. Official, simulation, and adult labels stay on their own badges.
 * The character create form still stores the default 260 unless a writer sets another value.
 */

export type CharacterHueAccent = {
  keyline: string;
  hover: string;
};

const FALLBACK_HUE = 260;

export function normalizeCharacterHue(hue: number): number {
  const raw = Number(hue);
  if (!Number.isFinite(raw)) return FALLBACK_HUE;
  return ((Math.round(raw) % 360) + 360) % 360;
}

/** Lightness stays high so the hover/label color remains readable on the charcoal card. */
export function characterHueAccent(hue: number): CharacterHueAccent {
  const safe = normalizeCharacterHue(hue);
  return {
    keyline: `hsl(${safe} 46% 62%)`,
    hover: `hsl(${safe} 32% 90%)`,
  };
}

import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import type { Font } from "three/examples/jsm/loaders/FontLoader.js";

export const ARTISAN_DICE_FONT_URL = "/fonts/optimer_bold.typeface.json";
export const ARTISAN_DICE_FONT_LOAD_TIMEOUT_MS = 3000;

let fontPromise: Promise<Font | null> | null = null;
let resolvedFont: Font | null | undefined;

/**
 * Module-level singleton font load/parse for engraved D20 numerals.
 * Bundled local asset — should resolve immediately when cached.
 * On failure/timeout resolves null; callers skip numerals and still roll.
 */
export function preloadArtisanDiceFont(): Promise<Font | null> {
  if (fontPromise) return fontPromise;
  fontPromise = new Promise((resolve) => {
    const loader = new FontLoader();
    let settled = false;
    const finish = (font: Font | null) => {
      if (settled) return;
      settled = true;
      resolvedFont = font;
      resolve(font);
    };
    const timeoutId = setTimeout(() => finish(null), ARTISAN_DICE_FONT_LOAD_TIMEOUT_MS);
    loader.load(
      ARTISAN_DICE_FONT_URL,
      (font) => {
        clearTimeout(timeoutId);
        finish(font);
      },
      undefined,
      () => {
        clearTimeout(timeoutId);
        finish(null);
      }
    );
  });
  return fontPromise;
}

/** Whether numeral geometry is ready to attach (font loaded or fallback elapsed). */
export function isArtisanDiceNumeralGeometryReady(): boolean {
  return resolvedFont !== undefined;
}

/** Reset singleton for unit tests only. */
export function resetArtisanDiceFontForTests(): void {
  fontPromise = null;
  resolvedFont = undefined;
}

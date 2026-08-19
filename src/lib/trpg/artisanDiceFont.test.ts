import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARTISAN_DICE_FONT_LOAD_TIMEOUT_MS,
  ARTISAN_DICE_FONT_URL,
  isArtisanDiceNumeralGeometryReady,
  resetArtisanDiceFontForTests,
} from "./artisanDiceFont";

describe("artisan dice font preload", () => {
  it("uses bundled local font path with finite timeout fallback", () => {
    resetArtisanDiceFontForTests();
    assert.match(ARTISAN_DICE_FONT_URL, /optimer_bold\.typeface\.json$/);
    assert.equal(ARTISAN_DICE_FONT_LOAD_TIMEOUT_MS, 3000);
    assert.equal(isArtisanDiceNumeralGeometryReady(), false);
  });
});

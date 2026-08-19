import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PRODUCTION_D20_THEME,
  TRPG_D20_NUMERAL,
  TRPG_D20_NUMERAL_WEIGHT,
  TRPG_D20_OVERLAY_DIM_CLASS,
  TRPG_D20_THEME,
  isTrpgD20ThemeId,
  normalizeTrpgD20ThemeId,
  trpgD20StaticOverlaySpec,
  trpgD20ThemeSpec,
} from "./diceVisual";

describe("TRPG D20 visual themes and projected scale", () => {
  it("defaults production to Obsidian Royal static overlay", () => {
    assert.equal(PRODUCTION_D20_THEME, "obsidian-royal");
    assert.equal(TRPG_D20_THEME, "obsidian-royal");
    const obsidian = trpgD20ThemeSpec("obsidian-royal");
    assert.equal(obsidian.look, "obsidian_royal");
    assert.equal(obsidian.texture, "obsidian-gold");
    assert.equal(obsidian.numeralWeight, 600);
    assert.equal(TRPG_D20_NUMERAL_WEIGHT, 600);
    assert.equal(TRPG_D20_NUMERAL, "#e8dcc0");
    assert.equal(obsidian.staticOverlay.assetReady, true);
    assert.equal(obsidian.staticOverlay.baseAsset, "/d20-result/obsidian-royal.webp");
    assert.equal(TRPG_D20_OVERLAY_DIM_CLASS, "bg-black/15");
    assert.equal(isTrpgD20ThemeId("obsidian-royal"), true);
    assert.equal(normalizeTrpgD20ThemeId("verdant-relic"), "obsidian-royal");
    assert.equal(normalizeTrpgD20ThemeId("obsidian-relic"), null);
  });

  it("keeps Ancient Reliquary palette on the shared static overlay system", () => {
    const ancient = trpgD20ThemeSpec("ancient-reliquary");
    assert.equal(ancient.look, "oxidized_bronze");
    assert.equal(ancient.texture, "oxidized-bronze");
    assert.equal(ancient.material.transmission, 0);
    assert.ok(ancient.material.metalness >= 0.62);
    assert.ok(ancient.material.metalness <= 0.78);
    assert.equal(ancient.staticOverlay.assetReady, false);
    assert.equal(trpgD20StaticOverlaySpec("ancient-reliquary").numeral.colors.normal, "#d6c7a1");
  });
});

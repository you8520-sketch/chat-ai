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
  trpgD20ResultHudStyle,
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

  it("paints the centered result HUD from existing theme numeral tokens", () => {
    const theme = trpgD20ThemeSpec("obsidian-royal");
    const overlay = theme.staticOverlay.numeral;
    const normal = trpgD20ResultHudStyle("obsidian-royal", "normal", 6);
    const double = trpgD20ResultHudStyle("obsidian-royal", "nat20", 16);
    const nat1 = trpgD20ResultHudStyle("obsidian-royal", "nat1", 1);
    const nat20 = trpgD20ResultHudStyle("obsidian-royal", "nat20", 20);

    assert.equal(normal.numeral.fontFamily, overlay.fontFamily);
    assert.equal(normal.numeral.fontWeight, 700);
    assert.equal(normal.numeral.fontSize, "clamp(58px, 12vw, 84px)");
    assert.equal(normal.numeral.letterSpacing, "0em");
    assert.equal(double.numeral.letterSpacing, overlay.letterSpacingDouble);
    assert.equal(normal.numeral.color, overlay.colors.normal);
    assert.equal(nat1.numeral.color, overlay.colors.nat1);
    assert.equal(nat20.numeral.color, overlay.colors.nat20);
    assert.match(normal.numeral.backgroundImage, new RegExp(overlay.gradient.normal.mid.slice(1)));
    assert.match(nat20.numeral.backgroundImage, new RegExp(overlay.gradient.nat20.hi.slice(1)));
    assert.equal(normal.numeral.WebkitTextStroke, `1.75px ${theme.palette.deepest}`);
    assert.match(normal.numeral.filter, new RegExp(overlay.glow.normal.replace(/[()]/g, "\\$&")));
    assert.match(normal.numeral.filter, new RegExp(theme.numeralStroke.slice(1)));
    assert.match(normal.haloBackground, /rgba\(0,0,0,0\.55\)/);
    assert.doesNotMatch(normal.haloBackground, /#[0-9a-fA-F]{3,8}/);
  });
});

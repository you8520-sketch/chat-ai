import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PRODUCTION_D20_THEME,
  TRPG_D20_DIAMETER_DESKTOP_BAND,
  TRPG_D20_DIAMETER_MOBILE_BAND,
  TRPG_D20_NUMERAL,
  TRPG_D20_NUMERAL_WEIGHT,
  TRPG_D20_OVERLAY_DIM_CLASS,
  TRPG_D20_STAGE_DESKTOP,
  TRPG_D20_STAGE_DESKTOP_BAND,
  TRPG_ARTISAN_VISIBLE_THROW_START_X,
  TRPG_D20_STAGE_MOBILE,
  TRPG_D20_STAGE_MOBILE_BAND,
  TRPG_D20_THEME,
  TRPG_D20_THROW_WINDOW_DESKTOP,
  TRPG_D20_THROW_WINDOW_MOBILE,
  isTrpgD20ThemeId,
  normalizeTrpgD20ThemeId,
  trpgD20ProjectedDiameterPx,
  trpgD20StaticOverlaySpec,
  trpgD20ThemeSpec,
  trpgD20WorldDeltaToPx,
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

  it("projects a small settled die inside the overlay stage bands", () => {
    const desktop = trpgD20ProjectedDiameterPx(TRPG_D20_STAGE_DESKTOP.height);
    const mobile = trpgD20ProjectedDiameterPx(TRPG_D20_STAGE_MOBILE.height);
    assert.ok(desktop >= TRPG_D20_DIAMETER_DESKTOP_BAND.min);
    assert.ok(desktop <= TRPG_D20_DIAMETER_DESKTOP_BAND.max);
    assert.ok(mobile >= TRPG_D20_DIAMETER_MOBILE_BAND.min);
    assert.ok(mobile <= TRPG_D20_DIAMETER_MOBILE_BAND.max);
    assert.ok(TRPG_D20_STAGE_DESKTOP.width >= TRPG_D20_STAGE_DESKTOP_BAND.width[0]);
    assert.ok(TRPG_D20_STAGE_DESKTOP.width <= TRPG_D20_STAGE_DESKTOP_BAND.width[1]);
    assert.ok(TRPG_D20_STAGE_DESKTOP.height >= TRPG_D20_STAGE_DESKTOP_BAND.height[0]);
    assert.ok(TRPG_D20_STAGE_DESKTOP.height <= TRPG_D20_STAGE_DESKTOP_BAND.height[1]);
    assert.ok(TRPG_D20_STAGE_MOBILE.width >= TRPG_D20_STAGE_MOBILE_BAND.width[0]);
    assert.ok(TRPG_D20_STAGE_MOBILE.width <= TRPG_D20_STAGE_MOBILE_BAND.width[1]);
    assert.ok(TRPG_D20_STAGE_MOBILE.height >= TRPG_D20_STAGE_MOBILE_BAND.height[0]);
    assert.ok(TRPG_D20_STAGE_MOBILE.height <= TRPG_D20_STAGE_MOBILE_BAND.height[1]);
    assert.equal(TRPG_D20_THROW_WINDOW_DESKTOP.height, TRPG_D20_STAGE_DESKTOP.height);
    assert.equal(TRPG_D20_THROW_WINDOW_MOBILE.height, TRPG_D20_STAGE_MOBILE.height);
    assert.ok(TRPG_D20_THROW_WINDOW_DESKTOP.width > TRPG_D20_STAGE_DESKTOP.width);
    assert.ok(TRPG_D20_THROW_WINDOW_MOBILE.width > TRPG_D20_STAGE_MOBILE.width);
    const desktopTravel = trpgD20WorldDeltaToPx(
      TRPG_ARTISAN_VISIBLE_THROW_START_X,
      TRPG_D20_STAGE_DESKTOP.height
    );
    const mobileTravel = trpgD20WorldDeltaToPx(
      TRPG_ARTISAN_VISIBLE_THROW_START_X,
      TRPG_D20_STAGE_MOBILE.height
    );
    assert.ok(desktopTravel >= 70 && desktopTravel <= 100, `desktop travel ${desktopTravel}`);
    assert.ok(mobileTravel >= 45 && mobileTravel <= 70, `mobile travel ${mobileTravel}`);
  });
});

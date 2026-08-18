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
  trpgD20ProjectedDiameterPx,
  trpgD20ThemeSpec,
  trpgD20WorldDeltaToPx,
} from "./diceVisual";

describe("TRPG D20 visual themes and projected scale", () => {
  it("defaults production to Verdant Relic smoked glass", () => {
    assert.equal(PRODUCTION_D20_THEME, "verdant-relic");
    assert.equal(TRPG_D20_THEME, "verdant-relic");
    const verdant = trpgD20ThemeSpec("verdant-relic");
    assert.equal(verdant.look, "smoked_glass");
    assert.equal(verdant.texture, "sparse-gold-motes");
    assert.equal(verdant.numeralWeight, 600);
    assert.equal(TRPG_D20_NUMERAL_WEIGHT, 600);
    assert.equal(TRPG_D20_NUMERAL, "#d6c7a1");
    assert.ok(verdant.material.transmission >= 0.22);
    assert.ok(verdant.material.transmission <= 0.35);
    assert.ok(verdant.material.clearcoat <= 0.28);
    assert.equal(TRPG_D20_OVERLAY_DIM_CLASS, "bg-black/15");
    assert.equal(isTrpgD20ThemeId("verdant-relic"), true);
    assert.equal(isTrpgD20ThemeId("obsidian-relic"), false);
  });

  it("keeps Ancient Reliquary as oxidized bronze without transmission", () => {
    const ancient = trpgD20ThemeSpec("ancient-reliquary");
    assert.equal(ancient.look, "oxidized_bronze");
    assert.equal(ancient.texture, "oxidized-bronze");
    assert.equal(ancient.material.transmission, 0);
    assert.ok(ancient.material.metalness >= 0.62);
    assert.ok(ancient.material.metalness <= 0.78);
    assert.ok(ancient.numeralFaceRatio.single >= 0.45);
    assert.ok(ancient.numeralFaceRatio.single <= 0.55);
    assert.ok(ancient.numeralFaceRatio.double >= 0.45);
    assert.ok(ancient.numeralFaceRatio.double <= 0.55);
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

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  TRPG_DICE_BOX_COLORSET,
  TRPG_DICE_ENGINE,
  TRPG_DICE_IMPLEMENTATION,
  TRPG_D20_NUMERAL,
  TRPG_D20_NUMERAL_WEIGHT,
  TRPG_D20_OVERLAY_DIM_CLASS,
  TRPG_PRODUCTION_DICE_STATIC_FALLBACK,
  trpgD20ResultHudStyle,
  trpgProductionDiceStaticFallback,
} from "./diceVisual";

describe("TRPG single production dice visual", () => {
  it("exposes one production 3D implementation and one static fallback spec", () => {
    assert.equal(TRPG_DICE_IMPLEMENTATION, "dice-box-threejs");
    assert.equal(TRPG_DICE_ENGINE, "production-d20");
    assert.equal(TRPG_D20_NUMERAL_WEIGHT, 600);
    assert.equal(TRPG_D20_NUMERAL, "#e8dcc0");
    assert.equal(TRPG_D20_OVERLAY_DIM_CLASS, "bg-black/55");
    assert.equal(trpgProductionDiceStaticFallback(), TRPG_PRODUCTION_DICE_STATIC_FALLBACK);
    assert.equal(TRPG_PRODUCTION_DICE_STATIC_FALLBACK.baseAsset, "/d20-result/obsidian-royal.webp");
    assert.equal(TRPG_PRODUCTION_DICE_STATIC_FALLBACK.assetReady, true);
    assert.equal(TRPG_DICE_BOX_COLORSET.material, "glass");
    assert.equal(TRPG_DICE_BOX_COLORSET.texture, "none");
    assert.equal(TRPG_DICE_BOX_COLORSET.font, "Cinzel");
  });

  it("paints the centered result HUD from the production fallback numeral tokens", () => {
    const overlay = TRPG_PRODUCTION_DICE_STATIC_FALLBACK.numeral;
    const normal = trpgD20ResultHudStyle("normal", 6);
    const nat1 = trpgD20ResultHudStyle("nat1", 1);
    const nat20 = trpgD20ResultHudStyle("nat20", 20);

    assert.equal(normal.numeral.fontFamily, overlay.fontFamily);
    assert.equal(normal.numeral.fontWeight, 700);
    assert.equal(normal.numeral.color, overlay.colors.normal);
    assert.equal(nat1.numeral.color, overlay.colors.nat1);
    assert.equal(nat20.numeral.color, overlay.colors.nat20);
    assert.match(normal.numeral.backgroundImage, new RegExp(overlay.gradient.normal.mid.slice(1)));
    assert.match(normal.haloBackground, /rgba\(0,0,0,0\.55\)/);
  });
});

describe("TRPG dice visual cleanup gates", () => {
  const repo = (path: string) => readFileSync(path, "utf8");
  const allSources = [
    "src/app/trpg/TrpgDiceOverlay.tsx",
    "src/app/trpg/TrpgCampaignRoom.tsx",
    "src/app/trpg/dice-lab/TrpgDiceLabClient.tsx",
    "src/lib/trpg/diceVisual.ts",
    "src/lib/trpg/dicePreviewTheme.ts",
  ].map(repo).join("\n");

  it("removes user theme selection and legacy theme ids", () => {
    assert.doesNotMatch(allSources, /TrpgDiceThemeSettings/);
    assert.doesNotMatch(allSources, /diceThemePrefs/);
    assert.doesNotMatch(allSources, /TRPG_D20_THEME_OPTIONS/);
    assert.doesNotMatch(allSources, /TRPG_DICE_THEME_KEY/);
    assert.doesNotMatch(allSources, /loadTrpgDiceTheme/);
    assert.doesNotMatch(allSources, /saveTrpgDiceTheme/);
    assert.doesNotMatch(allSources, /resolveTrpgDiceTheme/);
    assert.doesNotMatch(allSources, /ancient-reliquary/);
    assert.doesNotMatch(allSources, /gemstone-arcane/);
    assert.doesNotMatch(allSources, /verdant-relic/);
    assert.doesNotMatch(allSources, /emerald-relic/);
    assert.doesNotMatch(allSources, /TrpgD20ThemeId/);
    assert.doesNotMatch(allSources, /PRODUCTION_D20_THEME/);
  });

  it("keeps one overlay owner and a non-selectable static fallback path", () => {
    const overlay = repo("src/app/trpg/TrpgDiceOverlay.tsx");
    const lab = repo("src/app/trpg/dice-lab/TrpgDiceLabClient.tsx");
    assert.match(overlay, /trpgProductionDiceStaticFallback/);
    assert.match(overlay, /TRPG_STATIC_SETTLE_MS/);
    assert.match(overlay, /onDieSettled\("static"\)/);
    assert.match(overlay, /TrpgDiceBoxScene/);
    assert.match(lab, /<TrpgDiceOverlay/);
    assert.doesNotMatch(lab, /TrpgDiceBoxScene/);
    assert.doesNotMatch(lab, /Physics B/);
    assert.doesNotMatch(lab, /data-trpg-dice-lab-proto/);
    assert.doesNotMatch(lab, /TRPG_D20_THEME_OPTIONS/);
  });

  it("removes campaign diceTheme query overrides while keeping fixture injection", () => {
    const room = repo("src/app/trpg/TrpgCampaignRoom.tsx");
    const preview = repo("src/lib/trpg/dicePreviewTheme.ts");
    assert.doesNotMatch(room, /diceTheme/);
    assert.doesNotMatch(room, /queryTheme/);
    assert.doesNotMatch(room, /savedTheme/);
    assert.match(room, /dicePreview/);
    assert.match(preview, /dicePreview/);
    assert.match(preview, /resolveCampaignDicePreviewOverlay/);
    assert.doesNotMatch(preview, /diceTheme/);
  });
});

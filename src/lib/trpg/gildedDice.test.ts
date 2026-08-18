import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  TRPG_D20_FRAME_WIDTH_RATIO,
  TRPG_D20_GEM_INSET_DEPTH,
  TRPG_D20_GEM_SCALE,
  TRPG_D20_GOLD_BASE,
  TRPG_D20_GOLD_HIGHLIGHT,
  TRPG_D20_GOLD_SHADOW,
  TRPG_D20_NUMERAL_INLAY_HEIGHT_RATIO,
  TRPG_D20_NUMERAL_INLAY_LIFT,
  TRPG_D20_OXIDATION,
  TRPG_D20_VERTEX_CAP_RADIUS_RATIO,
  TRPG_D20_VISUAL_QUALITY,
  trpgD20ThemeSpec,
} from "./diceVisual";

describe("Gilded Verdant Relic geometry redesign (lab candidate)", () => {
  it("builds metal frame, inset gem, vertex caps, and metal numeral inlay as geometry", () => {
    const scene = fs.readFileSync("src/app/trpg/TrpgGildedDiceScene.tsx", "utf8");
    assert.match(scene, /BoxGeometry/);
    assert.match(scene, /SphereGeometry/);
    assert.match(scene, /collectUniqueEdges/);
    assert.match(scene, /collectUniqueVertices/);
    assert.match(scene, /triangleGeometry\(corners, TRPG_D20_GEM_SCALE, TRPG_D20_GEM_INSET_DEPTH\)/);
    assert.match(scene, /numeralPlaneGeometry/);
    assert.match(scene, /die\.quaternion\.copy\(end\)/);
    assert.doesNotMatch(scene, /EdgesGeometry|LineBasicMaterial|LineSegments/);
    assert.doesNotMatch(scene, /emissive/i);
    assert.doesNotMatch(scene, /fillText\(String\(value\), size \/ 2, size \/ 2 \+ 6\)/);
  });

  it("keeps structural ratios inside the requested bands", () => {
    assert.ok(TRPG_D20_FRAME_WIDTH_RATIO >= 0.025);
    assert.ok(TRPG_D20_FRAME_WIDTH_RATIO <= 0.04);
    assert.ok(TRPG_D20_GEM_INSET_DEPTH >= 0.02);
    assert.ok(TRPG_D20_GEM_INSET_DEPTH <= 0.04);
    assert.ok(TRPG_D20_VERTEX_CAP_RADIUS_RATIO <= 0.05);
    assert.ok(TRPG_D20_NUMERAL_INLAY_HEIGHT_RATIO >= 0.35);
    assert.ok(TRPG_D20_NUMERAL_INLAY_HEIGHT_RATIO <= 0.42);
    assert.ok(TRPG_D20_NUMERAL_INLAY_LIFT > 0);
    assert.ok(TRPG_D20_GEM_SCALE < 1);
    assert.equal(TRPG_D20_GOLD_BASE, "#b89a58");
    assert.equal(TRPG_D20_GOLD_HIGHLIGHT, "#e1cf9a");
    assert.equal(TRPG_D20_GOLD_SHADOW, "#4b381d");
    assert.equal(TRPG_D20_OXIDATION, "#2a2418");
  });

  it("wires the campaign overlay to the gilded scene only when that theme is selected", () => {
    const overlay = fs.readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(overlay, /TrpgGildedDiceScene/);
    assert.match(overlay, /theme === "gilded-verdant-relic"/);
    assert.match(room, /diceTheme/);
    assert.match(room, /useCampaignDicePreview/);
    assert.match(room, /resolveCampaignDicePreviewOverlay/);
    assert.doesNotMatch(room, /PRODUCTION_D20_THEME = "gilded-verdant-relic"/);
  });

  it("stays a lab candidate until a human reviews real screenshots", () => {
    assert.equal(TRPG_D20_VISUAL_QUALITY, "NEEDS_HUMAN_REVIEW");
    const gilded = trpgD20ThemeSpec("gilded-verdant-relic");
    assert.equal(gilded.look, "gilded_verdant_relic");
    assert.equal(gilded.texture, "gilded-verdant");
    assert.equal(gilded.numeralColor, "#b89a58");
  });
});

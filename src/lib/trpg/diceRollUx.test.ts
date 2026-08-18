import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { resolveTrpgD20Tone } from "./actionCardUi";
import {
  TRPG_D20_HOLD_AFTER_SETTLE_MS,
  TRPG_D20_PER_DIE_MS,
  TRPG_D20_THEME,
  TRPG_D20_TOTAL_CAP_MS,
  TRPG_DICE_BOX_THREEJS_ASSETS_COPIED,
  TRPG_DICE_BOX_THREEJS_REVIEWED,
  TRPG_DICE_ENGINE,
  TRPG_DICE_ENGINE_LICENSE,
  TRPG_DICE_RENDERER,
  orderTrpgDiceRolls,
  shouldAnimateTrpgDice3d,
  trpgDiceDurationMs,
  trpgDiceOverlayActive,
  trpgPredeterminedD20Notation,
} from "./diceRollUx";
import {
  PRODUCTION_DICE_PROTO,
  TRPG_D20_ANIMATION_MS,
  TRPG_DICE_BOX_COLORSET,
  TRPG_DICE_BOX_THREEJS_ASSETS_COPIED as VISUAL_ASSETS_COPIED,
  TRPG_DICE_IMPLEMENTATION,
  TRPG_DICE_PHYSICS_ENGINE,
} from "./diceVisual";

describe("TRPG 3D dice overlay contracts", () => {
  it("keeps server d20 as the predetermined landing value", () => {
    assert.equal(trpgPredeterminedD20Notation(16), "1d20@16");
    assert.equal(trpgPredeterminedD20Notation(1), "1d20@1");
    assert.equal(trpgPredeterminedD20Notation(20), "1d20@20");
    assert.equal(trpgPredeterminedD20Notation(6), "1d20@6");
    assert.equal(resolveTrpgD20Tone(16, "SUCCESS"), "success");
  });

  it("plays rolls in resolutionOrder and caps total motion", () => {
    const ordered = orderTrpgDiceRolls(
      [
        { participantId: 3, d20: 2 },
        { participantId: 1, d20: 16 },
        { participantId: 2, d20: 11 },
      ],
      [
        { participantId: 1 },
        { participantId: 2 },
        { participantId: 3 },
      ]
    );
    assert.deepEqual(
      ordered.map((row) => row.d20),
      [16, 11, 2]
    );
    const timing = trpgDiceDurationMs(3);
    assert.ok(timing.perDie >= TRPG_D20_PER_DIE_MS.min);
    assert.ok(timing.perDie <= TRPG_D20_PER_DIE_MS.max);
    assert.ok(timing.total <= TRPG_D20_TOTAL_CAP_MS);
    assert.ok(TRPG_D20_TOTAL_CAP_MS <= 1600);
    assert.ok(TRPG_D20_PER_DIE_MS.min >= 1100);
    assert.ok(TRPG_D20_PER_DIE_MS.max <= 1600);
    assert.ok(TRPG_D20_ANIMATION_MS >= 1100);
    assert.ok(TRPG_D20_ANIMATION_MS <= 1600);
    assert.ok(TRPG_D20_HOLD_AFTER_SETTLE_MS >= 400);
    assert.ok(TRPG_D20_HOLD_AFTER_SETTLE_MS <= 600);
  });

  it("falls back when WebGL is missing or motion is reduced", () => {
    assert.equal(shouldAnimateTrpgDice3d({ webgl: true, reducedMotion: false }), true);
    assert.equal(shouldAnimateTrpgDice3d({ webgl: false, reducedMotion: false }), false);
    assert.equal(shouldAnimateTrpgDice3d({ webgl: true, reducedMotion: true }), false);
    assert.equal(trpgDiceOverlayActive("GENERATING_NARRATION", [{ participantId: 1 } as never]), true);
    assert.equal(trpgDiceOverlayActive("ACTION_INPUT", [{ participantId: 1 } as never]), false);
  });

  it("keeps dice-box-threejs available without copying unverified textures or sounds", () => {
    assert.equal(TRPG_DICE_ENGINE, "obsidian-relic-d20");
    assert.equal(TRPG_DICE_ENGINE_LICENSE, "MIT");
    assert.equal(TRPG_D20_THEME, "obsidian-relic");
    assert.equal(PRODUCTION_DICE_PROTO, "A");
    assert.equal(TRPG_DICE_IMPLEMENTATION, "custom");
    assert.equal(TRPG_DICE_RENDERER, "custom");
    assert.equal(TRPG_DICE_PHYSICS_ENGINE, "none");
    assert.equal(TRPG_DICE_BOX_THREEJS_REVIEWED, true);
    assert.equal(TRPG_DICE_BOX_THREEJS_ASSETS_COPIED, false);
    assert.equal(VISUAL_ASSETS_COPIED, false);
    assert.equal(TRPG_DICE_BOX_COLORSET.texture, "none");
    assert.equal(TRPG_DICE_BOX_COLORSET.material, "glass");
    const pkg = fs.readFileSync("package.json", "utf8");
    assert.match(pkg, /@3d-dice\/dice-box-threejs/);
    const overlay = fs.readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");
    const custom = fs.readFileSync("src/app/trpg/TrpgDiceScene.tsx", "utf8");
    const box = fs.readFileSync("src/app/trpg/TrpgDiceBoxScene.tsx", "utf8");
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const lab = fs.readFileSync("src/app/trpg/dice-lab/TrpgDiceLabClient.tsx", "utf8");
    const card = fs.readFileSync("src/app/trpg/TrpgD20.tsx", "utf8");
    const lane = fs.readFileSync("src/app/trpg/TrpgRollResultLane.tsx", "utf8");
    assert.match(overlay, /ssr: false/);
    assert.match(overlay, /prefers-reduced-motion/);
    assert.match(overlay, /trpgPredeterminedD20Notation/);
    assert.match(overlay, /TrpgDiceScene/);
    assert.doesNotMatch(overlay, /TrpgDiceBoxScene/);
    assert.doesNotMatch(overlay, /renderer\?:/);
    assert.doesNotMatch(overlay, /w-\[min\(420px/);
    assert.doesNotMatch(overlay, /rounded-3xl border/);
    assert.doesNotMatch(overlay, /advance|gmCall|\/api\/trpg/);
    assert.match(custom, /landingQuaternion/);
    assert.match(custom, /IcosahedronGeometry/);
    assert.match(custom, /color: 0xffffff/);
    assert.match(custom, /die\.quaternion\.copy\(end\)/);
    assert.doesNotMatch(custom, /EdgesGeometry|LineBasicMaterial|LineSegments/);
    assert.doesNotMatch(custom, /textures\/|sounds\/|wizards|dungeons/i);
    assert.match(box, /1d20@|TRPG_DICE_BOX_NOTATION/);
    assert.match(box, /sounds: false/);
    assert.match(box, /theme_texture: ""/);
    assert.doesNotMatch(box, /public\/textures|public\/sounds/);
    assert.match(lab, /TrpgDiceBoxScene/);
    assert.match(lab, /data-trpg-dice-lab-proto="B"/);
    assert.match(room, /TrpgDiceOverlay/);
    assert.match(room, /TrpgRollResultLane/);
    assert.doesNotMatch(room, /<TrpgD20/);
    assert.match(lane, /data-trpg-roll-result="desktop"/);
    assert.match(lane, /w-\[72px\]/);
    assert.match(lane, /text-\[34px\]/);
    assert.match(card, /<svg/);
    assert.match(card, /data-trpg-d20-silhouette="icosahedron"/);
    assert.doesNotMatch(card, /WebGLRenderer/);
    assert.equal((room.match(/text=\{parsed\.prose \|\| action\.body\}/g) ?? []).length, 1);
  });
});

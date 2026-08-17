import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { resolveTrpgD20Tone } from "./actionCardUi";
import {
  TRPG_D20_PER_DIE_MS,
  TRPG_D20_THEME,
  TRPG_D20_TOTAL_CAP_MS,
  TRPG_DICE_BOX_THREEJS_ASSETS_COPIED,
  TRPG_DICE_BOX_THREEJS_REVIEWED,
  TRPG_DICE_ENGINE,
  TRPG_DICE_ENGINE_LICENSE,
  orderTrpgDiceRolls,
  shouldAnimateTrpgDice3d,
  trpgDiceDurationMs,
  trpgDiceOverlayActive,
  trpgPredeterminedD20Notation,
} from "./diceRollUx";

describe("TRPG 3D dice overlay contracts", () => {
  it("keeps server d20 as the predetermined landing value", () => {
    assert.equal(trpgPredeterminedD20Notation(16), "1d20@16");
    assert.equal(trpgPredeterminedD20Notation(1), "1d20@1");
    assert.equal(trpgPredeterminedD20Notation(20), "1d20@20");
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
  });

  it("falls back when WebGL is missing or motion is reduced", () => {
    assert.equal(shouldAnimateTrpgDice3d({ webgl: true, reducedMotion: false }), true);
    assert.equal(shouldAnimateTrpgDice3d({ webgl: false, reducedMotion: false }), false);
    assert.equal(shouldAnimateTrpgDice3d({ webgl: true, reducedMotion: true }), false);
    assert.equal(trpgDiceOverlayActive("GENERATING_NARRATION", [{ participantId: 1 } as never]), true);
    assert.equal(trpgDiceOverlayActive("ACTION_INPUT", [{ participantId: 1 } as never]), false);
  });

  it("does not copy unverified dice-box assets and keeps action cards static", () => {
    assert.equal(TRPG_DICE_ENGINE, "three-icosahedron-obsidian");
    assert.equal(TRPG_DICE_ENGINE_LICENSE, "MIT");
    assert.equal(TRPG_D20_THEME, "obsidian");
    assert.equal(TRPG_DICE_BOX_THREEJS_REVIEWED, true);
    assert.equal(TRPG_DICE_BOX_THREEJS_ASSETS_COPIED, false);
    const overlay = fs.readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");
    const scene = fs.readFileSync("src/app/trpg/TrpgDiceScene.tsx", "utf8");
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const card = fs.readFileSync("src/app/trpg/TrpgD20.tsx", "utf8");
    assert.match(overlay, /ssr: false/);
    assert.match(overlay, /prefers-reduced-motion/);
    assert.match(overlay, /trpgPredeterminedD20Notation/);
    assert.doesNotMatch(overlay, /advance|gmCall|\/api\/trpg/);
    assert.match(scene, /landingQuaternion/);
    assert.match(scene, /IcosahedronGeometry/);
    assert.doesNotMatch(scene, /textures\/|sounds\/|wizards|dungeons/i);
    assert.match(room, /TrpgDiceOverlay/);
    assert.match(room, /<TrpgD20 value=\{roll\.d20\}/);
    assert.match(card, /<svg/);
    assert.doesNotMatch(card, /WebGLRenderer/);
    assert.equal((room.match(/text=\{parsed\.prose \|\| action\.body\}/g) ?? []).length, 1);
    assert.doesNotMatch(fs.readFileSync("package.json", "utf8"), /dice-box-threejs/);
  });
});

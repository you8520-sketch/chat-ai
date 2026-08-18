import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import {
  TRPG_D20_BOUNCE1_HEIGHT,
  TRPG_D20_BOUNCE1_PEAK_T,
  TRPG_D20_BOUNCE2_HEIGHT,
  TRPG_D20_BOUNCE2_PEAK_T,
  TRPG_D20_FLOOR_Y,
  TRPG_D20_SETTLE_START,
  TRPG_D20_START_X,
  TRPG_D20_START_Y,
  diceDropHeight,
  dicePoseAt,
  randomStartEuler,
  randomUnitAxis,
  settleBlend,
  tumbleAngleRad,
} from "./diceAnim";

describe("custom D20 animation (no physics engine)", () => {
  it("keeps predetermined landing: settle is 0 until the last 15–20%, then 1 at t=1", () => {
    assert.ok(TRPG_D20_SETTLE_START >= 0.8);
    assert.ok(TRPG_D20_SETTLE_START <= 0.85);
    assert.equal(settleBlend(0), 0);
    assert.equal(settleBlend(0.5), 0);
    assert.equal(settleBlend(TRPG_D20_SETTLE_START), 0);
    assert.ok(settleBlend(0.91) > 0.2);
    assert.ok(settleBlend(0.91) < 0.9);
    assert.equal(settleBlend(1), 1);
    assert.equal(dicePoseAt(1).settle, 1);
    assert.equal(dicePoseAt(1).landed, true);
  });

  it("uses strong early spin and ease-out, not a constant air slerp", () => {
    const early = tumbleAngleRad(0.2) - tumbleAngleRad(0);
    const late = tumbleAngleRad(0.85) - tumbleAngleRad(0.65);
    assert.ok(early > late * 1.8);
    assert.ok(tumbleAngleRad(0.25) > 2.4);
    const scene = fs.readFileSync("src/app/trpg/TrpgDiceScene.tsx", "utf8");
    assert.match(scene, /landingQuaternion/);
    assert.match(scene, /die\.quaternion\.copy\(end\)/);
    assert.match(scene, /dicePoseAt/);
    assert.match(scene, /randomStartEuler/);
    assert.doesNotMatch(scene, /cannon|ammo\.js|rapier|physx/i);
    assert.doesNotMatch(scene, /from "@3d-dice\/dice-box-threejs"/);
  });

  it("falls, then one small bounce and a much smaller second bounce", () => {
    assert.ok(TRPG_D20_BOUNCE1_HEIGHT <= 0.34);
    assert.ok(TRPG_D20_BOUNCE2_HEIGHT <= TRPG_D20_BOUNCE1_HEIGHT * 0.35);
    const midFall = diceDropHeight(0.25);
    const firstContact = diceDropHeight(0.5);
    const bounce1 = diceDropHeight(TRPG_D20_BOUNCE1_PEAK_T);
    const bounce2 = diceDropHeight(TRPG_D20_BOUNCE2_PEAK_T);
    const rest = diceDropHeight(0.95);
    assert.ok(midFall > firstContact + 0.18);
    assert.ok(bounce1 > firstContact + 0.08);
    assert.ok(bounce2 > TRPG_D20_FLOOR_Y + 0.02);
    assert.ok(bounce1 > bounce2 * 2.5);
    assert.equal(diceDropHeight(1), TRPG_D20_FLOOR_Y);
    assert.ok(Math.abs(rest - TRPG_D20_FLOOR_Y) < 1e-9);
    const landed = dicePoseAt(1);
    assert.equal(landed.x, 0);
    assert.equal(landed.z, 0);
    assert.equal(landed.y, TRPG_D20_FLOOR_Y);
    assert.ok(TRPG_D20_START_Y <= 0.42);
    assert.ok(TRPG_D20_START_X <= 0.36);
    assert.ok(Math.abs(dicePoseAt(0).y - TRPG_D20_START_Y - TRPG_D20_FLOOR_Y) < 1e-9);
  });

  it("randomizes start rotation and tumble axis without changing the t=1 pose", () => {
    let n = 0;
    const a = randomStartEuler(() => {
      n += 0.17;
      return n % 1;
    });
    const b = randomStartEuler(() => {
      n += 0.31;
      return n % 1;
    });
    assert.notDeepEqual(a, b);
    assert.ok(a.x >= 0 && a.x < Math.PI * 2);
    const axis = randomUnitAxis(() => 0.37);
    const len = Math.hypot(axis.x, axis.y, axis.z);
    assert.ok(Math.abs(len - 1) < 1e-9);
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { decideTrpgDiceRenderer } from "./diceRendererDecision";
import {
  TRPG_RESULT_ENTER_MS,
  TRPG_RESULT_HOLD_MS,
  TRPG_RESULT_EXIT_MS,
  TRPG_STATIC_SETTLE_MS,
  isTrpgStaticSettleTimerStale,
  shouldScheduleTrpgStaticSettle,
  trpgDiceRevealWatchdogMs,
} from "./diceRollUx";
import { trpgDiceResultVisible } from "./diceContextHud";

describe("TRPG static renderer settle lifecycle", () => {
  const overlay = readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");

  it("1: static renderer + rolling schedules deterministic static settle", () => {
    assert.equal(TRPG_STATIC_SETTLE_MS >= 250, true);
    assert.equal(TRPG_STATIC_SETTLE_MS <= 400, true);
    assert.equal(
      shouldScheduleTrpgStaticSettle({
        visible: true,
        renderer: "static",
        resultPhase: "rolling",
        settled: false,
      }),
      true
    );
    assert.match(overlay, /shouldScheduleTrpgStaticSettle/);
    assert.match(overlay, /TRPG_STATIC_SETTLE_MS/);
    assert.match(overlay, /onDieSettled\("static"\)/);
  });

  it("2: static settle reuses onDieSettled and the existing RESULT_CONFIRM path", () => {
    assert.match(overlay, /onDieSettled\("static"\)/);
    assert.match(overlay, /setResultPhase\("entering"\)/);
    assert.match(overlay, /data-trpg-dice-result-confirm/);
    assert.match(overlay, /TRPG_RESULT_ENTER_MS/);
    assert.match(overlay, /TRPG_RESULT_HOLD_MS/);
    assert.match(overlay, /TRPG_RESULT_EXIT_MS/);
  });

  it("3: static result does not wait for the 10-second watchdog", () => {
    assert.ok(TRPG_STATIC_SETTLE_MS < 10_000);
    assert.match(overlay, /Static renderer: deterministic settle lifecycle/);
    assert.match(overlay, /WebGL only — static uses TRPG_STATIC_SETTLE_MS/);
    assert.match(overlay, /if \(!visible \|\| ordered\.length === 0 \|\| !use3d\) return/);
    assert.doesNotMatch(
      overlay,
      /shouldScheduleTrpgStaticSettle[\s\S]{0,400}watchdogMs: 10000/
    );
    assert.ok(trpgDiceRevealWatchdogMs(1) > TRPG_STATIC_SETTLE_MS);
  });

  it("4: before static settle d20/result/finalScore/tier are not visibly rendered", () => {
    assert.equal(trpgDiceResultVisible("rolling"), false);
    assert.doesNotMatch(overlay, /data-trpg-dice-numeral/);
    assert.match(overlay, /trpgDiceResultVisible\(resultPhase\)/);
    assert.match(overlay, /\{showResult \? \(/);
    assert.match(overlay, /data-trpg-dice-result-numeral/);
    assert.match(overlay, /data-trpg-dice-result-formula/);
  });

  it("5: after static settle formula and exact tier are visible", () => {
    assert.equal(trpgDiceResultVisible("entering"), true);
    assert.equal(trpgDiceResultVisible("holding"), true);
    assert.match(overlay, /data-trpg-dice-result-formula/);
    assert.match(overlay, /\{context\.tierLabel\}/);
    assert.match(overlay, /d20 \{context\.d20\}/);
    assert.match(overlay, /최종 \{context\.finalScore\}/);
  });

  it("6: reduced-motion renderer uses the same static settle lifecycle", () => {
    assert.equal(decideTrpgDiceRenderer({ webgl: true, reducedMotion: true }).renderer, "static");
    assert.equal(
      shouldScheduleTrpgStaticSettle({
        visible: true,
        renderer: decideTrpgDiceRenderer({ webgl: true, reducedMotion: true }).renderer,
        resultPhase: "rolling",
        settled: false,
      }),
      true
    );
    assert.match(overlay, /data-trpg-dice-reduced-motion/);
  });

  it("7: no-WebGL renderer uses the same static settle lifecycle", () => {
    assert.equal(decideTrpgDiceRenderer({ webgl: false, reducedMotion: false }).renderer, "static");
    assert.equal(
      shouldScheduleTrpgStaticSettle({
        visible: true,
        renderer: decideTrpgDiceRenderer({ webgl: false, reducedMotion: false }).renderer,
        resultPhase: "rolling",
        settled: false,
      }),
      true
    );
    assert.match(overlay, /data-trpg-dice-fallback-reason/);
  });

  it("8: WebGL renderer does not schedule static settle", () => {
    assert.equal(
      shouldScheduleTrpgStaticSettle({
        visible: true,
        renderer: "dice-box-threejs",
        resultPhase: "rolling",
        settled: false,
      }),
      false
    );
    assert.match(overlay, /TrpgDiceBoxScene/);
    assert.match(overlay, /onSettled=\{onDieSettled\}/);
  });

  it("9: stale timer from old session/index cannot settle a new roll", () => {
    assert.equal(
      isTrpgStaticSettleTimerStale({
        scheduledSessionKey: "4|1:12:11:SUCCESS",
        scheduledPlayIndex: 0,
        currentSessionKey: "4|2:8:11:FAIL",
        currentPlayIndex: 0,
      }),
      true
    );
    assert.equal(
      isTrpgStaticSettleTimerStale({
        scheduledSessionKey: "4|1:12:11:SUCCESS",
        scheduledPlayIndex: 0,
        currentSessionKey: "4|1:12:11:SUCCESS",
        currentPlayIndex: 1,
      }),
      true
    );
    assert.equal(
      isTrpgStaticSettleTimerStale({
        scheduledSessionKey: "4|1:12:11:SUCCESS",
        scheduledPlayIndex: 0,
        currentSessionKey: "4|1:12:11:SUCCESS",
        currentPlayIndex: 0,
      }),
      false
    );
    assert.match(overlay, /isTrpgStaticSettleTimerStale/);
    assert.match(overlay, /sessionKeyRef/);
    assert.match(overlay, /window\.clearTimeout\(timer\)/);
  });

  it("10: preserves existing nat1/nat20 and RESULT_CONFIRM timing", () => {
    assert.match(overlay, /data-trpg-dice-burst="nat20"/);
    assert.match(overlay, /data-trpg-dice-burst-ring="nat20"/);
    assert.match(overlay, /data-trpg-dice-burst-spark="nat20"/);
    assert.match(overlay, /data-trpg-dice-burst="nat1"/);
    assert.match(overlay, /data-trpg-dice-burst-ring="nat1"/);
    assert.match(overlay, /data-trpg-dice-burst-vignette="nat1"/);
    assert.equal(TRPG_RESULT_ENTER_MS, 180);
    assert.deepEqual(TRPG_RESULT_HOLD_MS, { 1: 850, 2: 650, 3: 500, 4: 500 });
    assert.equal(TRPG_RESULT_EXIT_MS, 200);
  });
});

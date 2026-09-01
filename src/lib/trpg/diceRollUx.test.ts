import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { resolveTrpgD20Tone } from "./actionCardUi";
import {
  TRPG_D20_HOLD_AFTER_SETTLE_MS,
  TRPG_D20_PER_DIE_MS,
  TRPG_D20_TOTAL_CAP_MS,
  TRPG_DICE_BOX_THREEJS_ASSETS_COPIED,
  TRPG_DICE_BOX_THREEJS_REVIEWED,
  TRPG_DICE_ENGINE,
  TRPG_DICE_ENGINE_LICENSE,
  TRPG_DICE_RENDERER,
  applyTrpgDiceOverlaySession,
  orderTrpgDiceRolls,
  shouldAnimateTrpgDice3d,
  shouldConsumeMountRollSession,
  trpgDiceDurationMs,
  trpgDiceRevealWatchdogMs,
  trpgEmeraldDiceTiming,
  trpgResultConfirmPerDieMs,
  trpgResultHoldMs,
  TRPG_EMERALD_MULTI_ROLL_CAP_MS,
  TRPG_RESULT_ENTER_MS,
  TRPG_RESULT_EXIT_MS,
  TRPG_RESULT_HOLD_MS,
  TRPG_STATIC_SETTLE_MS,
  trpgDiceOverlayActive,
  trpgDiceOverlayAfterSettle,
  trpgDiceOverlaySessionAction,
  trpgDiceOverlayVisible,
  trpgDiceRollSessionKey,
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
import { TRPG_MAX_SLOTS } from "./types";

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
    assert.ok(TRPG_D20_TOTAL_CAP_MS <= 2600);
    assert.ok(TRPG_D20_PER_DIE_MS.min >= 1100);
    assert.ok(TRPG_D20_PER_DIE_MS.max <= 2600);
    assert.ok(TRPG_D20_ANIMATION_MS >= 1100);
    assert.ok(TRPG_D20_ANIMATION_MS <= 2600);
    assert.ok(TRPG_D20_HOLD_AFTER_SETTLE_MS >= 200);
    assert.ok(TRPG_D20_HOLD_AFTER_SETTLE_MS <= 360);
  });

  it("falls back when WebGL is missing or motion is reduced", () => {
    assert.equal(shouldAnimateTrpgDice3d({ webgl: true, reducedMotion: false }), true);
    assert.equal(shouldAnimateTrpgDice3d({ webgl: false, reducedMotion: false }), false);
    assert.equal(shouldAnimateTrpgDice3d({ webgl: true, reducedMotion: true }), false);
    assert.equal(trpgDiceOverlayActive("ROLLING", [{ participantId: 1 } as never]), true);
    assert.equal(trpgDiceOverlayActive("ACTION_INPUT", [{ participantId: 1 } as never]), true);
    assert.equal(trpgDiceOverlayActive("ACTION_INPUT", []), false);
    const firstKey = trpgDiceRollSessionKey(4, [{ participantId: 1, d20: 11, dc: 12, tier: "SUCCESS" }]);
    const sameKey = trpgDiceRollSessionKey(4, [{ participantId: 1, d20: 11, dc: 12, tier: "SUCCESS" }]);
    assert.equal(firstKey, sameKey);
    assert.equal(firstKey.startsWith("4|"), true);
    assert.equal(
      trpgDiceOverlaySessionAction({
        rollSessionKey: firstKey,
        prevRollSessionKey: "",
        consumed: false,
        started: false,
        dismissed: false,
      }),
      "start"
    );
    assert.equal(
      trpgDiceOverlaySessionAction({
        rollSessionKey: firstKey,
        prevRollSessionKey: firstKey,
        consumed: false,
        started: true,
        dismissed: false,
      }),
      "keep"
    );
    assert.equal(
      trpgDiceOverlaySessionAction({
        rollSessionKey: firstKey,
        prevRollSessionKey: firstKey,
        consumed: true,
        started: false,
        dismissed: false,
      }),
      "clear"
    );
    assert.equal(
      shouldConsumeMountRollSession({
        rollSessionKey: firstKey,
        replayOnMount: false,
        isFirstObservation: true,
      }),
      true
    );
    assert.equal(
      shouldConsumeMountRollSession({
        rollSessionKey: firstKey,
        replayOnMount: true,
        isFirstObservation: true,
      }),
      false
    );
    assert.equal(
      trpgDiceOverlaySessionAction({
        rollSessionKey: trpgDiceRollSessionKey(9, [{ participantId: 3, d20: 2, dc: 14, tier: "FAIL" }]),
        prevRollSessionKey: "",
        consumed: false,
        started: false,
        dismissed: false,
      }),
      "start"
    );
    assert.deepEqual(trpgDiceOverlayAfterSettle(0, 1), { index: 0, dismissed: true });
    assert.deepEqual(trpgDiceOverlayAfterSettle(0, 2), { index: 1, dismissed: false });
    assert.deepEqual(trpgDiceOverlayAfterSettle(1, 2), { index: 1, dismissed: true });
    assert.equal(trpgDiceOverlayVisible(true, false, 1), true);
    assert.equal(trpgDiceOverlayVisible(true, true, 1), false);
    assert.equal(trpgDiceOverlayVisible(false, false, 1), false);
    assert.deepEqual(
      applyTrpgDiceOverlaySession({ started: false, dismissed: false, index: 3 }, "start"),
      { started: true, dismissed: false, index: 0 }
    );
  });

  it("uses dice-box-threejs as the production physics renderer with Obsidian Royal skin", () => {
    assert.equal(TRPG_DICE_PHYSICS_ENGINE, "cannon-es");
    assert.equal(TRPG_DICE_BOX_THREEJS_REVIEWED, true);
    assert.equal(TRPG_DICE_BOX_THREEJS_ASSETS_COPIED, false);
    assert.equal(VISUAL_ASSETS_COPIED, false);
    assert.equal(TRPG_DICE_BOX_COLORSET.texture, "none");
    assert.equal(TRPG_DICE_BOX_COLORSET.font, "Cinzel");
    assert.equal(TRPG_DICE_BOX_COLORSET.name, "obsidian-royal");
    const pkg = fs.readFileSync("package.json", "utf8");
    assert.match(pkg, /"@3d-dice\/dice-box-threejs"/);
    const overlay = fs.readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");
    const diceBoxScene = fs.readFileSync("src/app/trpg/TrpgDiceBoxScene.tsx", "utf8");
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const rail = fs.readFileSync("src/app/trpg/TrpgCampaignRail.tsx", "utf8");
    const lane = fs.readFileSync("src/app/trpg/TrpgRollResultLane.tsx", "utf8");
    assert.match(overlay, /TrpgDiceBoxScene/);
    assert.match(overlay, /trpgPredeterminedD20Notation/);
    assert.match(overlay, /trpgDiceOverlayAfterSettle/);
    assert.match(overlay, /trpgDiceOverlaySessionAction/);
    assert.match(overlay, /trpgDiceRollSessionKey/);
    assert.match(overlay, /trpgDiceOverlayVisible/);
    assert.match(overlay, /trpgEmeraldDiceTiming/);
    assert.match(overlay, /trpgProductionDiceStaticFallback/);
    assert.match(overlay, /data-trpg-dice-engine=\{use3d/);
    assert.match(overlay, /data-trpg-dice-webgl/);
    assert.match(overlay, /data-trpg-dice-reduced-motion/);
    assert.match(overlay, /data-trpg-dice-fallback-reason/);
    assert.match(overlay, /decideTrpgDiceRenderer/);
    assert.match(overlay, /data-trpg-dice-result-phase/);
    assert.match(overlay, /data-trpg-dice-result-confirm/);
    assert.match(overlay, /absolute inset-0 z-10 flex flex-col items-center justify-center/);
    assert.match(overlay, /data-trpg-dice-canvas="3d"\s*\n\s*>\s*\n\s*<TrpgDiceBoxScene/);
    assert.match(overlay, /className="absolute inset-0"\s*\n\s*data-trpg-dice-canvas="3d"/);
    assert.match(overlay, /data-trpg-dice-result-numeral/);
    assert.match(overlay, /data-trpg-dice-result-outcome/);
    assert.match(overlay, /trpgD20ResultHudStyle/);
    assert.match(overlay, /data-trpg-dice-result-halo/);
    assert.match(overlay, /resultHud\.numeral/);
    const visual = fs.readFileSync("src/lib/trpg/diceVisual.ts", "utf8");
    assert.match(visual, /'Cinzel'/);
    assert.match(visual, /clamp\(58px/);
    assert.match(overlay, /resultPhase !== "holding"/);
    assert.match(overlay, /trpg-nat-ring/);
    assert.match(overlay, /trpg-dice-burst-ring="nat20"/);
    assert.match(overlay, /trpg-dice-burst-spark="nat20"/);
    assert.match(overlay, /trpg-dice-burst-ring="nat1"/);
    assert.match(overlay, /trpg-dice-burst-vignette="nat1"/);
    assert.match(overlay, /overlay\.overlayDimClass/);
    assert.match(overlay, /data-trpg-dice-burst="nat20"/);
    assert.match(overlay, /data-trpg-dice-burst="nat1"/);
    assert.match(diceBoxScene, /gravity_multiplier:\s*400/);
    assert.match(diceBoxScene, /strength:\s*1/);
    assert.match(diceBoxScene, /baseScale:\s*75/);
    assert.doesNotMatch(diceBoxScene, /baseScale:\s*50/);
    assert.match(diceBoxScene, /event:\s*"DICE_ERROR_CODE"/);
    assert.match(diceBoxScene, /source:\s*"init-error"/);
    assert.match(diceBoxScene, /source:\s*"physics"/);
    assert.match(overlay, /source:\s*"watchdog"/);
    assert.match(room, /TrpgDiceOverlay/);
    assert.match(room, /TrpgRollResultLane/);
    assert.match(room, /trpgDiceRevealWatchdogMs/);
    assert.match(room, /shouldHideIncomingRollSession/);
    assert.match(room, /holdCurrentRoundReveal/);
    assert.match(room, /activePresentationRoll/);
    assert.match(room, /rolls=\{overlayRolls\}/);
    assert.match(room, /useCampaignDicePreview\(snap\)/);
    assert.doesNotMatch(rail, /TrpgDiceThemeSettings/);
    assert.match(lane, /data-trpg-roll-result="desktop"/);
    assert.ok(fs.existsSync("public/d20-result/obsidian-royal.webp"), "missing obsidian-royal D20 art");
  });

  it("hides roll outcome until the centered result-confirm HUD", () => {
    const overlay = fs.readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");
    assert.doesNotMatch(overlay, /\{roll\.name\} · D20 \{roll\.d20\} · \{outcome\}/);
    assert.match(overlay, /trpgRollOutcomeLabel\(roll\.tier\)/);
    assert.match(overlay, /data-trpg-dice-result-confirm/);
    assert.match(overlay, /data-trpg-dice-result-numeral=\{face\}/);
    assert.match(overlay, /data-trpg-dice-result-outcome=\{outcome\}/);
    assert.match(overlay, /\{showResult \? \(/);
    assert.match(overlay, /TRPG_RESULT_ENTER_MS/);
    assert.match(overlay, /trpgResultHoldMs/);
    assert.match(overlay, /TRPG_RESULT_EXIT_MS/);
  });

  it("paces result-confirm multi-roll so overlay finishes before the watchdog", () => {
    assert.equal(TRPG_RESULT_ENTER_MS, 180);
    assert.equal(TRPG_RESULT_HOLD_MS[1], 3500);
    assert.equal(TRPG_RESULT_EXIT_MS, 200);
    assert.equal(trpgResultHoldMs(1), 3500);
    assert.equal(trpgResultConfirmPerDieMs(1), 3880);

    const one = trpgEmeraldDiceTiming(1);
    assert.equal(one.perDieMs, trpgResultConfirmPerDieMs(1));
    assert.equal(one.perDieMs, 3880);
    assert.equal(one.totalMs, 3880);
    const two = trpgEmeraldDiceTiming(2);
    assert.equal(two.perDieMs, trpgResultConfirmPerDieMs(2));
    assert.equal(two.totalMs, 2060);
    const three = trpgEmeraldDiceTiming(3);
    assert.equal(three.perDieMs, trpgResultConfirmPerDieMs(3));
    assert.equal(three.totalMs, 2640);
    assert.ok(three.totalMs <= TRPG_EMERALD_MULTI_ROLL_CAP_MS);
    assert.ok(one.perDieMs > two.perDieMs);
    assert.ok(two.perDieMs > three.perDieMs);
    for (const n of [1, 2, 3, 4] as const) {
      const timing = trpgEmeraldDiceTiming(n);
      const watchdog = trpgDiceRevealWatchdogMs(n);
      assert.ok(timing.totalMs < watchdog);
      assert.ok(timing.totalMs <= TRPG_EMERALD_MULTI_ROLL_CAP_MS);
      assert.ok(watchdog >= 10_000);
    }
    assert.equal(trpgDiceRevealWatchdogMs(1), 12_880);
    const four = trpgEmeraldDiceTiming(4);
    assert.equal(four.perDieMs, trpgResultConfirmPerDieMs(4));
    assert.equal(four.perDieMs, 880);
    assert.equal(four.totalMs, 3520);
    assert.equal(trpgDiceRevealWatchdogMs(4), 12_520);
    assert.ok(four.totalMs <= TRPG_EMERALD_MULTI_ROLL_CAP_MS);
    assert.ok(three.perDieMs >= four.perDieMs);
    const ux = fs.readFileSync("src/lib/trpg/diceRollUx.ts", "utf8");
    assert.match(ux, /Math\.min\(TRPG_EMERALD_MULTI_ROLL_CAP_MS, perDieMs \* n\)/);
    assert.equal(TRPG_MAX_SLOTS, 4);
    const advance = fs.readFileSync("src/lib/trpg/engineAdvance.ts", "utf8");
    assert.match(advance, /loadFrozenAdjudicationDecision/);
    assert.doesNotMatch(advance, /subs\.slice\(0,\s*3\)/);
  });

  it("blocks sequential live rolls until each RESULT_CONFIRM lifecycle completes", () => {
    const perRollConfirmMs = trpgResultConfirmPerDieMs(1);
    assert.equal(perRollConfirmMs, TRPG_RESULT_ENTER_MS + TRPG_RESULT_HOLD_MS[1] + TRPG_RESULT_EXIT_MS);
    assert.equal(TRPG_STATIC_SETTLE_MS, 320);

    const overlay = fs.readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");
    assert.match(overlay, /trpgDiceOverlayAfterSettle/);
    assert.match(overlay, /setResultPhase\("rolling"\)/);
    assert.match(overlay, /TRPG_RESULT_EXIT_MS/);

    assert.deepEqual(trpgDiceOverlayAfterSettle(0, 1), { index: 0, dismissed: true });
    assert.deepEqual(trpgDiceOverlayAfterSettle(0, 3), { index: 1, dismissed: false });
    assert.deepEqual(trpgDiceOverlayAfterSettle(1, 3), { index: 2, dismissed: false });
    assert.deepEqual(trpgDiceOverlayAfterSettle(2, 3), { index: 2, dismissed: true });

    const roll1EndMs = perRollConfirmMs;
    const roll2EarliestStartMs = roll1EndMs;
    const roll2EndMs = roll2EarliestStartMs + perRollConfirmMs;
    const roll3EarliestStartMs = roll2EndMs;
    assert.ok(roll2EarliestStartMs >= roll1EndMs);
    assert.ok(roll3EarliestStartMs >= roll2EndMs);
    assert.equal(roll3EarliestStartMs + perRollConfirmMs, perRollConfirmMs * 3);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import { decideTrpgDiceRenderer, trpgDiceRendererDecisionAttrs } from "./diceRendererDecision";
import { shouldAnimateTrpgDice3d } from "./diceRollUx";

describe("TRPG dice renderer decision", () => {
  it("selects dice-box-threejs only when WebGL is on and reduced motion is off", () => {
    assert.deepEqual(decideTrpgDiceRenderer({ webgl: true, reducedMotion: false }), {
      webgl: true,
      reducedMotion: false,
      renderer: "dice-box-threejs",
      fallbackReason: "none",
    });
    assert.equal(shouldAnimateTrpgDice3d({ webgl: true, reducedMotion: false }), true);
  });

  it("falls back to static with an explicit no-webgl reason", () => {
    assert.deepEqual(decideTrpgDiceRenderer({ webgl: false, reducedMotion: false }), {
      webgl: false,
      reducedMotion: false,
      renderer: "static",
      fallbackReason: "no-webgl",
    });
    assert.deepEqual(decideTrpgDiceRenderer({ webgl: false, reducedMotion: true }), {
      webgl: false,
      reducedMotion: true,
      renderer: "static",
      fallbackReason: "no-webgl",
    });
  });

  it("falls back to static with an explicit reduced-motion reason when WebGL exists", () => {
    assert.deepEqual(decideTrpgDiceRenderer({ webgl: true, reducedMotion: true }), {
      webgl: true,
      reducedMotion: true,
      renderer: "static",
      fallbackReason: "reduced-motion",
    });
  });

  it("exposes decision data attributes for browser diagnostics", () => {
    assert.deepEqual(
      trpgDiceRendererDecisionAttrs(decideTrpgDiceRenderer({ webgl: true, reducedMotion: false })),
      {
        "data-trpg-dice-webgl": "true",
        "data-trpg-dice-reduced-motion": "false",
        "data-trpg-dice-fallback-reason": "none",
      }
    );
    const overlay = fs.readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");
    assert.match(overlay, /decideTrpgDiceRenderer/);
    assert.match(overlay, /data-trpg-dice-webgl/);
    assert.match(overlay, /data-trpg-dice-reduced-motion/);
    assert.match(overlay, /data-trpg-dice-fallback-reason/);
    assert.match(overlay, /DICE_RENDERER_DECISION/);
    assert.match(overlay, /WEBGL_AVAILABLE/);
    assert.match(overlay, /PREFERS_REDUCED_MOTION/);
    assert.match(overlay, /SELECTED_RENDERER/);
    assert.match(overlay, /FALLBACK_REASON/);
    assert.match(overlay, /TrpgDiceBoxScene/);
    assert.doesNotMatch(overlay, /3D 주사위/);
    assert.doesNotMatch(overlay, /사용 안 함/);
  });
});

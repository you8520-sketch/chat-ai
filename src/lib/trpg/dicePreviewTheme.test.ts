import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isTrpgDiceRuntimeInstrument,
  isTrpgDicePreviewRuntime,
  isTrpgProductionAppHost,
  parseDicePreviewD20,
  previewDiceOverlayFixture,
  previewDiceRollKey,
  resolveCampaignDicePreviewOverlay,
  shouldInjectPreviewDiceOverlay,
} from "./dicePreviewTheme";

describe("preview-only campaign dice fixture injection", () => {
  it("does not inject a fixture without dicePreview=1", () => {
    assert.equal(
      shouldInjectPreviewDiceOverlay({
        previewEnabled: true,
      }),
      false
    );
    const live = resolveCampaignDicePreviewOverlay({
      previewEnabled: true,
      phase: "ACTION_INPUT",
      currentRolls: [],
    });
    assert.equal(live.inject, false);
    assert.equal(live.phase, "ACTION_INPUT");
    assert.equal(live.rolls.length, 0);
  });

  it("injects a fixture only when dicePreview=1 on a preview runtime", () => {
    assert.equal(
      shouldInjectPreviewDiceOverlay({
        previewEnabled: true,
        queryPreview: "1",
      }),
      true
    );
    const injected = resolveCampaignDicePreviewOverlay({
      previewEnabled: true,
      queryPreview: "1",
      phase: "ACTION_INPUT",
      currentRolls: [],
      fixtureName: "유라",
    });
    assert.equal(injected.inject, true);
    assert.equal(injected.phase, "ROLLING");
    assert.equal(injected.rolls[0]?.d20, 14);
    assert.equal(injected.rolls[0]?.name, "유라");
  });

  it("allows preview-only dicePreviewD20 override for QA capture", () => {
    const existing = previewDiceOverlayFixture("기존", 7);
    const nat20 = resolveCampaignDicePreviewOverlay({
      previewEnabled: true,
      queryPreview: "1",
      queryPreviewD20: "20",
      phase: "ACTION_INPUT",
      currentRolls: [existing],
    });
    assert.equal(nat20.rolls[0]?.d20, 20);
    assert.equal(nat20.rolls[0]?.tier, "CRITICAL_SUCCESS");
    const nat1 = resolveCampaignDicePreviewOverlay({
      previewEnabled: true,
      queryPreview: "1",
      queryPreviewD20: "1",
      phase: "ACTION_INPUT",
      currentRolls: [],
    });
    assert.equal(nat1.rolls[0]?.d20, 1);
    assert.equal(nat1.rolls[0]?.tier, "CRITICAL_FAILURE");
  });

  it("never injects when dicePreviewD20 is supplied without the preview switch", () => {
    const live = resolveCampaignDicePreviewOverlay({
      previewEnabled: true,
      queryPreviewD20: "20",
      phase: "ACTION_INPUT",
      currentRolls: [],
    });
    assert.equal(live.inject, false);
    assert.equal(live.rolls.length, 0);
    for (const invalid of ["", "0", "21", "1.5", "abc"]) {
      assert.equal(parseDicePreviewD20(invalid), null);
    }
  });

  it("never injects on the production Railway host", () => {
    assert.equal(isTrpgProductionAppHost("chat-ai-production-3e84.up.railway.app"), true);
    assert.equal(isTrpgProductionAppHost("CHAT-AI-PRODUCTION-3E84.UP.RAILWAY.APP"), true);
    const previewEnabled = isTrpgDicePreviewRuntime({
      nodeEnv: "production",
      previewFlag: "1",
      hostname: "chat-ai-production-3e84.up.railway.app",
    });
    assert.equal(previewEnabled, false);
    assert.equal(
      shouldInjectPreviewDiceOverlay({ previewEnabled, queryPreview: "1" }),
      false
    );
    const live = resolveCampaignDicePreviewOverlay({
      previewEnabled,
      queryPreview: "1",
      queryPreviewD20: "20",
      phase: "ACTION_INPUT",
      currentRolls: [],
    });
    assert.equal(live.inject, false);
  });

  it("keeps real-round phase and rolls when preview is off", () => {
    const roll = previewDiceOverlayFixture("권태현");
    const live = resolveCampaignDicePreviewOverlay({
      previewEnabled: true,
      phase: "ROLLING",
      currentRolls: [{ ...roll, d20: 17, participantId: 4 }],
    });
    assert.equal(live.inject, false);
    assert.equal(live.phase, "ROLLING");
    assert.equal(live.rolls.length, 1);
    assert.equal(live.rolls[0]?.d20, 17);
    assert.equal(previewDiceRollKey(live.rolls), "4:17");
    assert.equal(isTrpgDicePreviewRuntime({ nodeEnv: "development", hostname: "localhost" }), true);
  });

  it("validates permanent dice lifecycle events without extra metadata", () => {
    const dimensions = {
      hostWidth: 1266,
      hostHeight: 801,
      canvasClientWidth: 1280,
      canvasClientHeight: 801,
      canvasWidth: 1280,
      canvasHeight: 801,
    };
    assert.equal(isTrpgDiceRuntimeInstrument({
      event: "DICE_ROLL_RESOLVED",
      data: { boxId: "dice-box", diceListLength: 1, ...dimensions },
      timestamp: 1,
    }), true);
    assert.equal(isTrpgDiceRuntimeInstrument({
      event: "DICE_ERROR_CODE",
      data: { boxId: "dice-box", code: "DICE_INIT_ERROR", errorName: "Error", ...dimensions },
      timestamp: 2,
    }), true);
    assert.equal(isTrpgDiceRuntimeInstrument({
      event: "DICE_SETTLE_SOURCE",
      data: { boxId: "dice-box", source: "init-error", operation: "initialize" },
      timestamp: 3,
    }), true);
    assert.equal(isTrpgDiceRuntimeInstrument({
      event: "DICE_SETTLE_SOURCE",
      data: { source: "watchdog", watchdogMs: 10_000 },
      timestamp: 4,
    }), true);
    assert.equal(isTrpgDiceRuntimeInstrument({
      event: "DICE_SETTLE_SOURCE",
      data: { source: "static", staticSettleMs: 320, sessionKey: "4|1:12:11:SUCCESS", playIndex: 0 },
      timestamp: 5,
    }), true);
    assert.equal(isTrpgDiceRuntimeInstrument({
      event: "DICE_RENDERER_DECISION",
      data: {
        WEBGL_AVAILABLE: true,
        PREFERS_REDUCED_MOTION: false,
        SELECTED_RENDERER: "dice-box-threejs",
        FALLBACK_REASON: "none",
      },
      timestamp: 6,
    }), true);
    assert.equal(isTrpgDiceRuntimeInstrument({
      event: "DICE_RENDERER_DECISION",
      data: {
        WEBGL_AVAILABLE: true,
        PREFERS_REDUCED_MOTION: false,
        SELECTED_RENDERER: "custom",
        FALLBACK_REASON: "none",
      },
      timestamp: 7,
    }), false);
    assert.equal(isTrpgDiceRuntimeInstrument({
      event: "DICE_ROLL_RESOLVED",
      debugMetadata: true,
      data: { boxId: "dice-box", diceListLength: 1, ...dimensions },
      timestamp: 5,
    }), false);
  });
});
